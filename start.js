'use strict';
// Run this under node to start the indexing process.  It will start a
// 'getlinks' command to fetch the Wikipedia articles linked to a given page

const Readline = require('readline');
const Fs = require('fs');
const Redis = require('redis');
const Bluebird = require('bluebird');
const WF = require('word-freq');

// Add promises to Redis
Bluebird.promisifyAll(Redis.RedisClient.prototype);
Bluebird.promisifyAll(Redis.Multi.prototype);

// Initialise globals
var redis = Redis.createClient();
redis.on("error", function (err) {
	console.log("Error " + err);
});

function findDocs(query) {
	var freq = WF.freq(query);

	// Uses the Redis ZREVRANGEBYSCORE command to get the pageid-weight values
	// and returns a Promise that will resolve to a two element array of the term
	// and the corresponding weights that have been fetched.
	function getWeights(term) {
		return redis.zrevrangebyscoreAsync('bm25:term:' + term, '+inf', 0, 'WITHSCORES')
		.then((weights) => { return [term, weights]; });
	}

	var promises = [];
	var termweights = {};
	for (let t in freq) {
		promises.push(getWeights(t));
	}

	return Bluebird.all(promises)
	// w is an array of the outcome of the getWeights promises
	.then((w) => {
		// sim is a hash keyed by pageid, holding the similarity score
		var sim = {};
		for (let t of w) {
			// Each element is array containing term plus an array of
			// pageid-weight pairs.
			let term = t[0];
			let pageid;
			// Loop over he page-weight value pairs
			while (pageid = t[1].shift()) {
				let weight = parseFloat(t[1].shift());
				// Initialise the similarity if needed
				if (!sim[pageid]) sim[pageid] = 0;
				// Multiply the weight by the frequency, and add it into the similarity
				sim[pageid] += weight * freq[term];
			}
		}
		var simkeys = Object.keys(sim).sort(function(a,b){
			return sim[b] - sim[a];
		});
		return simkeys;
	});
}

function handleEntry(mode, index, text) {
	switch (mode) {
	case 'load':
		return redis.lpushAsync('worker', JSON.stringify(['processpage', index, text]));
		break;
	case 'query':
		return findDocs(text).then((docs) => {
			var pages = docs; //.sort((a,b) => { return a - b; });
			for (let pageid of pages) {
				console.log(`${index} 0 ${pageid} 1`);
			}
		}) ;
		break;
	}
}

function processFile(mode, file) {
	return new Promise((resolve, reject) => {
		var rs = Fs.createReadStream(file);
		var rl = Readline.createInterface({ input: rs });

		var promises = [];
		var index = '';
		var text = '';
		rl.on('line', (line) => {
			var input = line.match(/^\.I (\d+)$/);
			if (input) {
				// If text has been read, process it
				if (text.length > 0) {
					//console.log(`Read for index ${index}: ${text.split(/\s*(\.)\.*\s*|\s+/)}`);
					promises.push(handleEntry(mode, index, text));
				}
				index = input[1];
			}
			else if (line.match(/^.W$/)) {
				// Clear the text buffer
				text = '';
			}
			else {
				// Append the line to the text buffer, making sure there's a space at the end
				text += line + ' ';
			}
		});
		rl.on('close', () => {
			if (text.length > 0) {
				promises.push(handleEntry(mode, index, text));
				//console.log(`Read for index ${index}: ${text.split(/\s*(\.)\.*\s*|\s+/)}`);
			}
			console.log(`end of file`);
			Promise.all(promises)
			.then(() => { resolve(); });		
		});
	});
}

var mode;
var file;
switch (process.argv[2]) {
case 'load':
	redis.flushdbAsync()
	.then(() => {
		return processFile('load', 'med/MED.ALL');
	})
	.then(() => {
		redis.quit();
	});
	break;
case 'query':
	processFile('query', 'med/MED.QRY')
	.then(() => {
		redis.quit();
	});
	break;
default:
	console.error('invalid mode');
	process.exit(2);
	break;
}
