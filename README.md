# twi
The Wikipedia Index

This was created for a college module to help me understand tf-idf information retrieval schemes.  At the moment only BM25 has been implemented.

This design is based around two Docker containers running node.js and Redis.  The node.js container invokes twi.js which is a worker script that listens on a Redis list called 'worker'.

The twi worker commands are JSON requests and include the commands getlinks, getpage, and flush.  The getlinks expects a query formatted for the MediaWiki module that returns a list of pages.  The example in start.js uses the Wikipedia:Vital_articles page to get the top 1000 pages from Wikipedia.  The twi worker processing the getlinks query then sends the links coming back from Wikipedia as individual getpage requests to actually fetch the content of the pages.

This design and its use of Docker comtainers is intended to allow multiple workers to fetch pages in parallel because different workers can process the getpage requests on the Redis list.  Currently the load balancing doesn't work very well because getpage is not handled as a synchronous request.

Very little testing has been performed, and there are many use cases that have yet to be explored.  At the moment I start the Docker containers using the docker-compose.yml file:

> docker-compose up

And then I run these three commands:

> node start
> node calc_weights
> node query

Note that there's a bug in calc_weights.js that means you have to hit control-C when it gets to the end (i.e. prints 0 representing the end of the Redis cursor).

More documentation about the structure of the Redis keys is TBC.