// Run this to execute a query against the index.  Basically it fetches the BM25
// queried terms' weights for the indexed documents, calculates BM25 similarity
// and returns the top 10.

// This is the query string.  Change this to query for something else
var query = 'bicycle';

const Redis = require('redis');
const WF = require('word-freq');
const Bluebird = require('bluebird');

// Add promises to Redis
Bluebird.promisifyAll(Redis.RedisClient.prototype);
Bluebird.promisifyAll(Redis.Multi.prototype);

// Initialise globals
var redis = Redis.createClient();
redis.on("error", function (err) {
	console.log("Error " + err);
});

var freq = WF.freq(query);
console.log(freq);

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
	var sim = {};
	for (t in w) {
		var i = 0;
		while (i < w[t][1].length) {
			if (!sim[w[t][1][i]]) sim[w[t][1][i]] = 0;
			sim[w[t][1][i]] += parseFloat(w[t][1][i+1]) * freq[w[t][0]];
			i += 2;
		}
	}
	var simkeys = Object.keys(sim).sort(function(a,b){
		return sim[b] - sim[a];
	});
	promises = [];
	for (i = 0; i < 10; i++) {
		promises.push(redis.hmgetAsync('page:' + simkeys[i], 'title', 'fullurl'));
	}
	return promises;
})
.then((promises) => {
	Bluebird.all(promises)
	.then((res) => {
		console.log(res);		
	});
	redis.quit();
});