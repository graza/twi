# twi
The Wikipedia Index

This was created for a college module to help me understand tf-idf information retrieval schemes.  At the moment only BM25 has been implemented, although modified to also use pairs of words in the document and/or query.

This design is based around three Docker containers running an R-Shiny app, a node.js "worker" component, and Redis.  The node.js container invokes `worker.js` which is a script that listens on a Redis list called 'worker'.  The twi worker commands are JSON requests and include the commands `getlinks`, `getpage`, `processpage`, `finddocs` and `flush`.  

The `getlinks` command expects a query formatted for the MediaWiki module that returns a list of pages.  The example in `start.js` uses the Wikipedia:Vital_articles page to get the top 1000 pages from Wikipedia.  The twi worker processing the `getlinks` command then sends the links coming back from Wikipedia as individual `getpage`.

The twi worker receiving the `getpage` command expects the page info structure as a parameter, and requests the content of the page.  This is then passed through stop word removal, Porter stemming and a term and edge frequency count before the details are put into Redis.  The same text processing is also performed in response to the `processpage` command.

The following Redis keys are created/updated as a result of processing a page:

* term:&lt;term> - Sorted set of pageid and term frequency values for &lt;term>
* page:&lt;pageid> - info property of Wikipedia page &lt;pageid>
* pages - Count of the number of pages indexed
* dl:&lt;pageid> - Document length of page &lt;pageid>
* dltot - Sum total of all document lengths

The `finddocs` command expects a query string and this is also passed through the term/edge frequency processing as above (including stop work removal and stemming).  The result is comapred against the indexed terms/edges using BM25 and the result returned to the sender of the command.

This design and its use of Docker comtainers is intended to allow multiple workers to fetch pages in parallel because different workers can process the getpage requests on the Redis list.  It would also allow additional processing to be performed by adding more Docker containers.

At the moment I start the Docker containers using the docker-compose.yml file:

```
> docker-compose up
```

And then I run these commands:

```
> cd worker
> node start load 
```

The `start.js` script is currently hard coded to load `med/MED.ALL` (i.e. the Medline test collection) also accepts a `query` load switch instead of `load` to run the queries in `med/MED.QRY`.

