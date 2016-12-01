// This script calculates all the BM25 term weights

const Redis = require('redis');

// Initialise globals
var redis = Redis.createClient();
redis.on("error", function (err) {
	console.log("Error " + err);
});
var pages;
var dlavg;

// Calculate weights as w[i,j] = freq[i,j] * log(N/n[i])
function iterate_terms(cursor) {
	redis.scan(cursor, "MATCH", "term:*", "COUNT", 1000, function(err, value) {
		if (value[1]) {
			value[1].forEach(function(term) {
				calculate_weights(term, 0);
			});
		}
		console.log(value[0]);
		if (value[0] > 0) {
			iterate_terms(value[0]);
		}
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
			return function(err, dl) {
				if (err) return console.error(err);
				var bm25 = bm25_term_weight(tf, pages, ni, parseInt(dl), dlavg);
				//console.log('setting bm25 to ' + bm25);
				redis.zadd('bm25:' + term, bm25, pageid);
			};
		}
		// Now scan the sorted set of document frequencies
		redis.zscan(term, cursor, 'COUNT', 100, function(err, value) {
			if (err) return console.error(err);
			//console.log(value);
			// Get the number of docs containing the term
			if (value[1]) {
				// Result will be pairs of pageid and frequency
				var tf = value[1];
				var i = 0;
				var bm25 = {};
				while (i < tf.length) {
					//weights[i] = 'w' + weights[i];
					//weights[i+1] = weights[i+1] * Math.log(pages / termCount)
					//var wterm = 'w' + term;
					redis.get('dl:' + tf[i], weights_update(tf[i], parseInt(tf[i+1])));
					i += 2;
				}
				// Could add the weights to the db as another sorted set
				// but it is more space efficient to leave it until later
				// Load the weighted terms into Redis
				//redis.zadd('w' + term, ...weights);
				//console.log(weights);
			}
			// If there are more pages to fetch, call self to go fetch them
			if (value[0] > 0) {
				weights_cursor(ni, value[0]);
			}
		});
	}
	// For the term, we need the number of docs that contain the term
	var cterm = 'c' + term;
	redis.get(cterm, function(err, ni) {
		if (err) return console.error(err);
		weights_cursor(parseInt(ni), 0);
	});
}

// Caculate weights for BM25/Okapi algorithm
function bm25_term_weight(tf, N, ni, dl, dlavg) {
	var k1 = 0.35;
	var b = 0.8;
	//console.log(tf, N, ni, dl, dlavg);
	return (tf * Math.log((N - ni + 0.5)/(ni + 0.5)))/(tf + k1 * ((1 - b) + b * dl / dlavg));
}

redis.get('pages', function(err, l_pages) {
	pages = parseInt(l_pages);
	console.log("pages " + pages);
	redis.get('dlavg', function(err, l_dlavg) {
		dlavg = parseFloat(l_dlavg);
		console.log("dlavg " + dlavg);
		//calculate_weights('term:china');
		iterate_terms(0);
	})
});

