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
redis.on("error", function (err) {
	console.log("Error " + err);
});

var bot = new MediaWiki.Bot();
bot.settings.rate = 50; // 0.05 seconds between requests
bot.settings.userAgent = "twi/0.1 (graham.agnew@gmail.com)";

// Run the query and submit all pages returned to the worker(s)
// for processing.  If the query has a 'continue' property,
// run the next query by merging that into the query.
function getlinks(query, cb) {
	// Make sure the query will fetch the info property
	query.action = 'query';
	query.prop = 'info';
	query.inprop = 'url';
	bot.get(query).complete((response) => {
		console.log(response);
		var links = response.query.pages;
		var l;
		var reqs = [];
		for (l in links) {
			reqs.push((JSON.stringify(['getpage', links[l]])));
		}
		redis.lpushAsync('worker', reqs);
		// Fetch next set of pages if there is more available.
		if (response.continue) {
			getlinks(Object.assign(query, response.continue));
			//redis.lpush('worker', JSON.stringify(['getlinks', Object.assign(query, response.continue)]));
		}
	});
}

// Get the text of the page
function getpage(info) {
	redis.hmset("page:" + info.pageid, info);
	bot.get({
		action: "query",
		prop: "extracts",
		pageids: info.pageid,
		explaintext: "t",
		exsectionformat: "plain"
	}).complete(function (response) {
		//console.log(response);
		var page = response.query.pages[info.pageid];
		if (page.extract) {
			//redis.incr("pages");
			processpage(page);
		}
		else {
			console.log("no extract for " + page.title)
		}
	});
}

// Put the page into Redis
function processpage(page) {
	console.log(page.title);
	var freq = WF.freq(page.extract);
	var dl = 0;
	for (t in freq) {
		redis.zadd("term:" + t, freq[t], page.pageid);
		redis.incr("cterm:" + t);
		dl += freq[t];
	}
	// dl - Document Length is the sum of the term frequency
	redis.set("dl:" + page.pageid, dl);
	update_dlavg(dl);
}

function update_dlavg(dl) {
	// Time to update the document length and document length average
	// Uses a lua script that runs in Redis to do so.  This makes the
	// update of dlavg and pages an atomic operation.
	var script = "local pages = tonumber(redis.call('GET', 'pages') or 0)\n\
	local dlavg = tonumber(redis.call('GET', 'dlavg') or 0)\n\
	local dlavg = (pages * dlavg + tonumber(ARGV[1])) / (pages + 1)\n\
	redis.call('SET', 'dlavg', dlavg)\n\
	redis.call('INCR', 'pages')";
	redis.eval(script, 0, dl, function(err, val) {
		if (err) { console.error('script failed ' + err); }
	});
}

// We use a separate client for the command queue
// This is because it's a blocking operation and can't be
// run in conjunction with other Redis commands.
var redisq = Redis.createClient({host: "redis"});
redisq.on("error", function (err) {
	console.log("Error " + err);
});

function server(queue) {
	console.log('listening on queue ' + queue);
	redisq.brpopAsync(queue, 0)
	.then((msg) => {
		console.log(msg);
		req = JSON.parse(msg[1]);
		switch (req[0]) {
		case 'getlinks':
			getlinks(req[1]);
			break;
		case 'getpage':
			getpage(req[1]);
			break;
		case 'flush':
			redis.flushdb();
			break;
		default:
			console.log('Unexpected request: ' + req);
			break;
		}
		// Go back to servicing the queue
		server(queue);
	});
}
server('worker');

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


