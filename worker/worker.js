'use strict;'

/* TWI - The Wikipedia Index
 * Copyright (C) Graham Agnew 2016
 * Uses Redis to create a tf-idf index for pages from Wikipedia.
 *
 * Redis keys:
 * term:<term> - Sorted set of pageid and term frequency values for <term>
 * cterm:<term> - Number of pages containing <term>
 * page:<pageid> - info property of Wikipedia page <pageid>
 * pages - Count of the number of pages indexed
 * dl:<pageid> - Document length of page <pageid>
 *
 * The weight for a term within a page can be calculated
 * by fetching the following:
 *   - "pages" as N,
 *   - "cterm:<term>" as n,
 *   - ""
 */

// Load libraries
const MediaWiki = require('mediawiki');
const Redis = require('redis');
const WF = require('word-freq');
const Bluebird = require('bluebird');

// Add promises to Redis
Bluebird.promisifyAll(Redis.RedisClient.prototype);
Bluebird.promisifyAll(Redis.Multi.prototype);

// Initialise globals
var redis = Redis.createClient({host: "redis"});
redis.on("error", (err) => {
	console.log("Error " + err);
});

var bot = new MediaWiki.Bot();
bot.settings.rate = 50; // 0.05 seconds between requests
bot.settings.userAgent = "twi/0.1 (graham.agnew@gmail.com)";

// Run the query and submit all pages returned to the worker(s)
// for processing.  If the query has a 'continue' property,
// run the next query by merging that into the query.
function getlinks(query, cb) {
	return new Promise((resolve, reject) => {
		// Make sure the query will fetch the info property
		query.action = 'query';
		query.prop = 'info';
		query.inprop = 'url';
		bot.get(query).complete((response) => {
			//console.log(response);
			var links = response.query.pages;
			var l;
			var reqs = [];
			for (l in links) {
				reqs.push((JSON.stringify(['getpage', links[l]])));
			}
			redis.lpushAsync('worker', reqs).then(() => {
				// Fetch next set of pages if there is more available.
				if (response.continue) {
					resolve(getlinks(Object.assign(query, response.continue)));
					//redis.lpush('worker', JSON.stringify(['getlinks', Object.assign(query, response.continue)]));
				}
				else {
					resolve();
				}
			});
		});
	});
}

// Get the text of the page
function getpage(info) {
	return new Promise((resolve, reject) => {
		redis.hmsetAsync("page:" + info.pageid, info)
		.then(() => {
			bot.get({
				action: "query",
				prop: "extracts",
				pageids: info.pageid,
				explaintext: "t",
				exsectionformat: "plain"
			}).complete((response) => {
				//console.log(response);
				var page = response.query.pages[info.pageid];
				console.log(page.title);
				if (page.extract) {
					//redis.incr("pages");
					resolve(processpage(page.id, page.extract));
				}
				else {
					console.log("no extract for " + page.title);
					resolve();
				}
			});
		});
	});
}

function frequencies(text) {
	var stems = WF.stem(text);
	const window = 4;
	var tfreq = {};
	var bfreq = {};
	for (var i = 0; i < stems.length; i++) {
		// Update term frequency
		if (tfreq.hasOwnProperty(stems[i])) tfreq[stems[i]] += 1;
		else tfreq[stems[i]] = 1;
		// Update bigram frequencies
		for (var j = Math.max(0, i - window); j < i; j++) {
			var bigram = stems[j] + ':' +stems[i];
			var weight = 1/(i - j);
			if (bfreq.hasOwnProperty(bigram)) bfreq[bigram] += weight;
			else bfreq[bigram] = weight;
		}
	}
	return {
		terms: tfreq,
		bigrams: bfreq
	}	
}

// Put the page into Redis
function processpage(pageid, text) {
	var dl = 0;
	var promises = [];
	//var freq = WF.freq(text);
	var freq = frequencies(text);
	promises.push(redis.setAsync("page:" + pageid + ":text", text));
	//promises.push(redis.saddAsync("page:" + pageid + ":terms", Object.keys(freq.terms)));
	//promises.push(redis.saddAsync("page:" + pageid + ":edges", Object.keys(freq.bigrams)));
	for (t in freq.terms) {
		promises.push(redis.zaddAsync("term:" + t, freq.terms[t], pageid));
		//promises.push(redis.incrAsync("cterm:" + t));
		dl += freq.terms[t];
	}
	for (t in freq.bigrams) {
		promises.push(redis.zaddAsync("term:" + t, freq.bigrams[t], pageid));
		//promises.push(redis.incrAsync("cterm:" + t));
		//dl += freq.bigrams[t];
	}
	// dl - Document Length is the sum of the term frequency
	promises.push(redis.setAsync("dl:" + pageid, dl));
	promises.push(redis.incrAsync("pages"));
	promises.push(redis.incrbyAsync("dltot", dl));
	return Promise.all(promises);
}

// Find and rank documents
function finddocs(query, termw, edgew) {
	//var freq = WF.freq(query);
	var freq = frequencies(query);
	//console.log(`freq = ${JSON.stringify(freq)}, termw = ${termw}, edgew = ${edgew}`);

	// Caculate weights for BM25/Okapi algorithm
	// Parameters:
	//   tf    - The term frequency within the document
	//   N     - Total number of documents
	//   n     - Number of documents that contain the term
	//   dl    - Document length
	//   dlavg - Average document length
	function bm25_term_weight(tf, N, n, dl, dlavg) {
		var k1 = 0.35;
		var b = 0.8;
		//console.log(tf, N, ni, dl, dlavg);
		return (tf * Math.log((N - n + 0.5)/(n + 0.5)))/(tf + k1 * ((1 - b) + b * dl / dlavg));
	}

	// Returns a promise that resolves to [pageid, weight]
	function calc_weight(tf, n, pageid) {
		return redis.getAsync('dl:' + pageid)
		.then((dl) => {
			return [pageid, bm25_term_weight(tf, pages, n, parseFloat(dl), dlavg)];
		});
	}

	// Uses the Redis ZREVRANGEBYSCORE command to get the pageid-weight values
	// and returns a Promise that will resolve to a two element array of the term
	// and a hash of the pageid and corresponding weight values that have been fetched.
	function get_term_freq(term) {
		return Promise.all([
			redis.zcardAsync('term:' + term),
			redis.zrevrangebyscoreAsync('term:' + term, '+inf', 0, 'WITHSCORES')
		])
		.then((nw) => {
			var n = parseInt(nw[0]);
			var w = nw[1];
			// For each page id in w, need to get its document length
			var promises = [];
			for (var i = 0; i < w.length; i += 2) {
				promises.push(calc_weight(parseFloat(w[i+1]), n, w[i]));
			}
			return Promise.all(promises);
		})
		.then((page_weights) => {
			//console.log(`get_term_freq(${term})=${JSON.stringify(page_weights)}`)
			return [term, page_weights];
		});
	}

	// Start by getting current global values for number of pages and average document length
	var pages;
	var dlavg;
	return Promise.all([
		redis.getAsync('pages'),
		redis.getAsync('dltot')
	]).then((value) => {
		pages = parseInt(value[0]);
		//console.log("pages " + pages);
		dlavg = parseFloat(value[1]) / pages;
		//console.log("dlavg " + dlavg);

		// iterate over the terms in the query;
		var promises = [];
		var termweights = {};
		for (var t in freq.terms) {
			promises.push(get_term_freq(t));
		}
		for (var t in freq.bigrams) {
			promises.push(get_term_freq(t));
		}

		return Promise.all(promises);
	})
	.then((w) => {
		//console.log("resolved promises: " + JSON.stringify(w));
		// w is an array of the outcome of the getWeights promises
		//console.log(`w=${JSON.stringify(w)}`);
		var sim = {};
		for (var t of w) {
			// Each t is array containing term plus an array of
			// pageid-weight object.
			var term = t[0];
			var weights = t[1];
			//console.log(`\nterm = ${term}\nweights = ${JSON.stringify(weights)}`);
			for (page of weights) {
				var pageid = page[0];
				var weight = page[1];
				var thisweight = 0;
				//console.log(`\npageid = ${pageid}\nweight = ${weight}`);
				// Initialise the similarity if needed
				// Multiply the weight by the frequency, and add it into the similarity
				if (freq.terms.hasOwnProperty(term)) {
					thisweight = weight * freq.terms[term] * termw;
				}
				else {
					thisweight = weight * freq.bigrams[term] * edgew;
				}
				if (thisweight > 0) {
					if (!sim.hasOwnProperty(pageid)) sim[pageid] = 0;
					sim[pageid] += thisweight;
				}
			}
		}
		//console.log("sim = " + JSON.stringify(sim));
		var pageids = Object.keys(sim).sort((a,b) => {
			return sim[b] - sim[a];
		});
		var pageweights = [];
		for (pageid of pageids) {
			pageweights.push([pageid, sim[pageid]]);
		}
		return {
			freq: freq,
			pageids: pageweights
		};
	});
}

// We use a separate client for the command queue
// This is because it's a blocking operation and can't be
// run in conjunction with other Redis commands.
var redisq = Redis.createClient({host: "redis"});
redisq.on("error", (err) => {
	console.log("Error " + err);
});

function server(queue) {
	//console.log('listening on queue ' + queue);
	redisq.brpopAsync(queue, 0)
	.then((msg) => {
		//console.log(msg);
		req = JSON.parse(msg[1]);
		var p = undefined;
		switch (req[0]) {
		case 'getlinks':
			p = getlinks(req[1]);
			break;
		case 'getpage':
			p = getpage(req[1]);
			break;
		case 'processpage':
			p = processpage(req[1], req[2]);
			break;
		case 'flush':
			p = redis.flushdbAsync();
			break;
		case 'finddocs':
			p = finddocs(req[2], parseFloat(req[3]), parseFloat(req[4]))
			.then((pageids) => {
				return redis.lpushAsync(req[1], JSON.stringify(pageids));
			});
			break;
		default:
			console.log('Unexpected request: ' + req);
			return server(queue);
		}
		p.then(() => {
			server(queue);
		});
	})
	.catch((err) => {
		console.error(err);
		server(queue);
	});
}
server('worker');
console.log('worker started'); 

// Example query to get the top 1000 articles
query = ['getlinks', {
	action: "query", 
	generator: "links",
	titles: "Wikipedia:Vital_articles",
	prop: "info",
	gpllimit: 500,
	gplnamespace: 0,
	inprop: "url"
}];


