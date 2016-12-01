// Run this under node to start the indexing process.  It will start a
// 'getlinks' command to fetch the Wikipedia articles linked to a given page

const Redis = require('redis');

// Initialise globals
var redis = Redis.createClient();
redis.on("error", function (err) {
	console.log("Error " + err);
});

query = ['getlinks', {
	action: "query", 
	generator: "links",
	titles: "Wikipedia:Vital_articles",
	prop: "info",
	gpllimit: 500,
	gplnamespace: 0,
	inprop: "url"
}];

redis.flushdb(function(err) {
	if (err) return console.error(err);
	redis.lpush('worker', JSON.stringify(query), function(err) {
		if (err) console.error(err);
		redis.quit();
	});	
});
