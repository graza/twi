// Run this to execute a query against the index.  Basically it fetches the BM25
// queried terms' weights for the indexed documents, calculates BM25 similarity
// and returns the top 10.

const Readline = require('readline');
const Fs = require('fs');
const Redis = require('redis');
const WF = require('word-freq');
const Bluebird = require('bluebird');

// Add promises to Redis
Bluebird.promisifyAll(Redis.RedisClient.prototype);
Bluebird.promisifyAll(Redis.Multi.prototype);

// Initialise globals
var redis = Redis.createClient();
redis.on("error", (err) => {
	console.log("Error " + err);
});

function findDocs(query) {
	var freq = WF.freq(query);
	console.log(freq);

	// Uses the Redis ZREVRANGEBYSCORE command to get the pageid-weight values
	// and returns a Promise that will resolve to a two element array of the term
	// and the corresponding weights that have been fetched.
	function getWeights(term) {
		return redis.zrevrangebyscoreAsync('bm25:term:' + t, '+inf', 0, 'WITHSCORES')
		.then((weights) => { return [term, weights]; });
	}

	var promises = [];
	var termweights = {};
	for (t in freq) {
		promises.push(getWeights(t));
	}

	Bluebird.all(promises)
	.then((w) => {
		// w is an array of the outcome of the getWeights promises
		var sim = {};
		for (t in w) {
			// Each t is array containing term plus an array of
			// pageid-weight pairs.
			var i = 0;
			// Loop over he page-weight value pairs
			while (i < w[t][1].length) {
				// Initialise the similarity if needed
				if (!sim[w[t][1][i]]) sim[w[t][1][i]] = 0;
				// Multiply the weight by the frequency, and add it into the similarity
				sim[w[t][1][i]] += parseFloat(w[t][1][i+1]) * freq[w[t][0]];
				i += 2; // Move to next pair
			}
		}
		var simkeys = Object.keys(sim).sort((a,b) => {
			return sim[b] - sim[a];
		});
		return simkeys;
		promises = [];
		for (i = 0; i < 10; i++) {
			//promises.push(redis.hmgetAsync('page:' + simkeys[i], 'title', 'fullurl'));
		}
		return promises;
	})
	.then((promises) => {
		Bluebird.all(promises)
		.then((res) => {
			console.log(res);		
		})
		.then(() => {
			redis.quit();
		});
	});
}

