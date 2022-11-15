# mongodb-scripts
Collection of mongodb scripts


## random-verify.mongodb
The steps performed in the verification script are outlined below
1. For each collection in the whitelisted databases
   1. Select a random set of _id from the given collection. The selection is run on the source collection and runs against the _id index. The selection is configured by supplying,
      * Total sample size
      * Number of sections to partition the collection space
      * The script will pick up a proportional number of documents from each partition.
      * If the requested sample size is larger than the collection size, then all the collection will be considered.
   1. Using the chosen _id’s, the script will run the following process on both the source and the destination databases,
      * Find the required documents.
      * Order all the keys in the document in alphabetical order (to counteract the different behavior between MongoDB 3.0 and MongoDB 4.4).
      * Output the result into a temporary output collection.
   1. Generate the dbHash for the output collections.
   1. Compare dbHash’es and report.

