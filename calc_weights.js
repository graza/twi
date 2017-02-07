'use strict';
// This script calculates all the BM25 term weights
// Redis keys created:
//   bm25:<term> - Sorted set of pageid with weight

const Redis = require('redis');
const Bluebird = require('bluebird');

// Add promises to Redis
Bluebird.promisifyAll(Redis.RedisClient.prototype);
Bluebird.promisifyAll(Redis.Multi.prototype);

// Initialise globals
var redis = Redis.createClient();
redis.on("error", function (err) {
	console.log("Error " + err);
});
var pages;
var dlavg;

// Calculate weights as w[i,j] = freq[i,j] * log(N/n[i])
function iterate_terms(cursor) {
	return redis.scanAsync(cursor, "MATCH", "term:*", "COUNT", 1000)
	.then((value) => {
		var promises = [];
		if (value[1]) {
			value[1].forEach(function(term) {
				promises.push(calculate_weights(term, 0));
			});
		}
		console.log(value[0]);
		if (value[0] > 0) {
			promises.push(iterate_terms(value[0]));
		}
		return Promise.all(promises);
	});
}

function calculate_weights(term) {
	// Create a closure to hold on to the overall term frquency
	// and fetch the term frequencies within those docs that contain them
	function weights_cursor(ni, cursor) {
		// Function that returns a callback that receives the document length
		// and has parameters for the pageid and document term frequency
		// The result of calculating document term weight(s) is put back into Redis
		function weights_update(pageid, tf) {
			return function(dl) {
				var bm25 = bm25_term_weight(tf, pages, ni, parseInt(dl), dlavg);
				//console.log('setting bm25 to ' + bm25);
				return redis.zaddAsync('bm25:' + term, bm25, pageid);
			};
		}
		// Now scan the sorted set of document frequencies
		return redis.zscanAsync(term, cursor, 'COUNT', 100)
		.then((value) => {
			//console.log(value);
			// Get the number of docs containing the term
			var promises = [];
			if (value[1]) {
				// Result will be pairs of pageid and frequency
				var tf = value[1];
				var bm25 = {};
				let pageid;
				while (pageid = tf.shift()) {
					let freq = parseInt(tf.shift());
					promises.push(
						redis.getAsync('dl:' + pageid)
						.then(weights_update(pageid, freq))
					);
				}
				// Could add the weights to the db as another sorted set
				// but it is more space efficient to leave it until later
				// Load the weighted terms into Redis
				//redis.zadd('w' + term, ...weights);
				//console.log(weights);
			}
			// If there are more pages to fetch, call self to go fetch them
			if (value[0] > 0) {
				promises.push(weights_cursor(ni, value[0]));
			}
			return Promise.all(promises);
		});
	}
	// For the term, we need the number of docs that contain the term
	var cterm = 'c' + term;
	return redis.getAsync(cterm).then((ni) => {
		return weights_cursor(parseInt(ni), 0);
	});
}

// Caculate weights for BM25/Okapi algorithm
function bm25_term_weight(tf, N, ni, dl, dlavg) {
	var k1 = 0.35;
	var b = 0.8;
	//console.log(tf, N, ni, dl, dlavg);
	return (tf * Math.log((N - ni + 0.5)/(ni + 0.5)))/(tf + k1 * ((1 - b) + b * dl / dlavg));
}

Promise.all([
	redis.getAsync('pages'),
	redis.getAsync('dltot')
]).then((value) => {
	pages = parseInt(value[0]);
	console.log("pages " + pages);
	dlavg = parseFloat(value[1]) / pages;
	console.log("dlavg " + dlavg);
		//calculate_weights('term:china');
	return iterate_terms(0);
})
.then(() => {
	redis.quit();
});

