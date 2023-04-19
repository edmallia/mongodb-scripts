randomVerifier = function (loggingDbName,
                          destUsername,
                          destPassword,
                          destConnString,
                          sampleSize, 
                          partitions, 
                          databaseWhitelist){

  //initialise databaseWhitelist
  if (databaseWhitelist && !Array.isArray(databaseWhitelist)){
    print("*** Database whitelist: " + JSON.stringify(databaseWhitelist));
    print("databaseWhitelist should be an array or null if no white list is required");
    return;
  }
  else if (databaseWhitelist && Array.isArray(databaseWhitelist)){
    if (databaseWhitelist.length === 0){
      print("*** Database whitelist: " + JSON.stringify(databaseWhitelist));
      print("databaseWhitelist is empty array, but should contain at least one database to verify. If all databases should be verified, pass null for databaseWhitelist.");
      return;
    }
    else {
      print("*** Database whitelist: " + JSON.stringify(databaseWhitelist));
    }
  }
  else {
    print("*** No database whitelist provided. Proceeding with all databases.");
  }

  loggingDb = db.getSiblingDB(loggingDbName);
  outCollPrefix = "out";
  jobCollName = "job";
  logCollName = "log";

  runId = ObjectId();
  print("*** Starting new run with id " + runId.toString());
  loggingDb.getCollection(jobCollName).insert({_id: runId, verificationType: "random", start: ISODate()});
  runSummary = {
    db : {
      processed : [],
      skipped: []
    },
    coll : {
      processed : 0,
      skipped : 0,
      matches: 0,
      mismatches: 0 
    }
  }
  
  destMongo = new Mongo(destConnString).getDB("admin")
  if (!destPassword){
    print("Executing passwordPrompt() function to obtain destination password")
    pwd = passwordPrompt();
  }
  else if (destPassword && typeof destPassword === 'function'){
    print("Executing supplied password function to obtain destination password")
    pwd = destPassword();
  }
  else{
    pwd = destPassword;
  }
  destMongo.auth(destUsername, pwd);
  destLoggingDB = destMongo.getSiblingDB(loggingDbName);

  db.adminCommand("listDatabases").databases.forEach(function(d) {
    sourceDB = db.getSiblingDB(d.name);
    destDB = destLoggingDB.getSiblingDB(d.name);

    if (d.name !== 'admin' && d.name != 'local' && d.name != 'config') {
      sourceDB.getCollectionInfos().forEach(function(c) {
        collStartDate = ISODate();
        ns = d.name + "." + c.name;

        if (d.name === loggingDbName){
          print("Skipping loggingDb collection: " + ns);
          addUniqueValueToArray(d.name, runSummary.db.skipped);
          recordSkippedCollection(loggingDb, logCollName, runSummary, ns, runId, collStartDate);
        }
        else if (c.name.startsWith('system.')){
          print("Skipping system collection: " + ns);
          recordSkippedCollection(loggingDb, logCollName, runSummary, ns, runId, collStartDate);
        }
        else if (databaseWhitelist && Array.isArray(databaseWhitelist) && databaseWhitelist.indexOf(d.name) < 0){
          print("Skipping collection as not part of database whitelist: " + ns);
          addUniqueValueToArray(d.name, runSummary.db.skipped);
          recordSkippedCollection(loggingDb, logCollName, runSummary, ns, runId, collStartDate);
        }
        else {
          print("Processing collection: " + ns);
          addUniqueValueToArray(d.name, runSummary.db.processed);
          runSummary.coll.processed++;


          //collection init
          outCollName = outCollPrefix + "." + d.name + "." + c.name;
          loggingDb.getCollection(outCollName).drop();
          destLoggingDB.getCollection(outCollName).drop();

          sourceColl = sourceDB.getSiblingDB(d.name).getCollection(c.name);

          //load ids to work with
          loadedIds = loadIds(sourceColl, sampleSize, partitions);

          //extract and compute hash on source
          extractSampleDocs(sourceDB, c.name, loadedIds, loggingDbName, outCollName);
          srcMd5 = computeHashForCollection(loggingDb, outCollName);

          //extract and compute hash on dest
          destDB = destLoggingDB.getSiblingDB(d.name);
          extractSampleDocs(destDB, c.name, loadedIds, loggingDbName, outCollName);
          destMd5 = computeHashForCollection(destLoggingDB, outCollName);

          matched = (srcMd5 === destMd5)
          if (matched){
            runSummary.coll.matches++;
          }
          else{
            runSummary.coll.mismatches++;
          }

          resultDoc = {
            runId : runId,
            ns : ns,
            skipped: false,
            verificationType: "random",
            start : collStartDate,
            noDocs: loadedIds.length,
            srcMd5 : srcMd5, 
            dstMd5 : destMd5,
            matched : matched
          }

          //add additional logs in case of errors and maintain temp collections
          if (!matched){
            resultDoc.ids = loadedIds;
          }
          else{
            loggingDb.getCollection(outCollName).drop();
            destLoggingDB.getCollection(outCollName).drop();
          }

          loggingDb.getCollection(logCollName).insert(resultDoc);
        }
      });
    }
  });
  
  runSummary.end = ISODate();
  loggingDb.getCollection(jobCollName).update({_id: runId}, {$set: runSummary});
  
  print("*** Results Summary ...")
  job = loggingDb.getCollection(jobCollName).findOne({_id: runId});
  print(JSON.stringify(job,null,'\t'))
  print("*** Skipped collections  ...")
  results = loggingDb.getCollection(logCollName)
                      .find({runId: runId, skipped: true}, {_id:0, ns:1})
                      .toArray().map(function(x){return x.ns;});
  print(JSON.stringify(results,null,'\t'));
  
  print("*** Mismatches ...")
  results = loggingDb.getCollection(logCollName).find({runId: runId, matched: false}).toArray();
  print(JSON.stringify(results,null,'\t'))


  print("*** To show details of all the processed collections, run the following on the source database ...");
  print("   use " + loggingDbName);
  print("   db." + logCollName + ".find({runId: " + runId.toString() + ", skipped: false}).pretty()");
  
  if (results && results.length > 0){
    print("*** To view the _id of all the mismatched collections, run the following on the source database ...");
    print("   use " + loggingDbName);
    print("   db." + logCollName + ".find({runId: " + runId.toString() + ", matched: false}).pretty()");
    print("*** ")
  }
  

}

addUniqueValueToArray = function (value, array){
  if (array.indexOf(value) < 0){
    array.push(value);
  }
}

recordSkippedCollection = function(loggingDb, logCollName, runSummary, ns, runId, collStartDate){
  runSummary.coll.skipped++;
  resultDoc = {
            runId : runId,
            ns : ns,
            skipped: true,
            verificationType: "random",
            start : collStartDate,
            end : collStartDate,
          }
  loggingDb.getCollection(logCollName).insert(resultDoc);
}

//coll - collection
//sampleSize - total no of documents to sample
//partitions - no of partitions to sample from 
loadIds = function(coll, sampleSize, partitions){
  collCount = coll.count();
  result = [];
  cursor = null;
  if (collCount < sampleSize){
    cursor = coll.find({}, {_id:1}).sort({_id:1});
    cursor.forEach(function (x) { result.push(x._id);});
  }
  else{
    partitionSize = collCount / partitions;
    // print("partitionSize:" + partitionSize)
    partitionSampleSize = sampleSize / partitions;
    // print("partitionSampleSize:" + partitionSampleSize)

    for (i = 0; i < partitions; i++){
      randOffset = Math.random() * (partitionSize-partitionSampleSize);
      // print("randOffset: " + randOffset + " offsetStart: " + (randOffset + (i * partitionSize)));
      cursor = coll.find({}, {_id:1})
        .sort({_id:1})
        .skip(randOffset + (i * partitionSize))
        .limit(partitionSampleSize);
        
      cursor.toArray().forEach(function (x) { result.push(x._id);});
    }
  }
  return result;
}

var extractSampleDocs = function(targetDb, collName, ids, loggingDbName, outColl){
  targetDb.runCommand(
    {
      mapReduce: collName, 
      map: mapFunction, 
      reduce: reduceFunction, 
      query: { "_id" : {$in : ids}},  
      sort : {_id:1}, 
      out: {replace : outColl, db: loggingDbName}
    }
  )
}

var computeHashForCollection = function(targetDb, collName){
  return targetDb.runCommand ( { dbHash: 1, collections: [ collName ] } ).collections[collName];
}

var mapFunction = function(){
  var isObject = function(v) {
      return '[object Object]' === Object.prototype.toString.call(v)
          || '[object BSON]' === Object.prototype.toString.call(v);
  };

  var isArray = function(o){return Array.isArray(o);}

  var keys = function(obj) {
    var keys = [];

    for (var i in obj) {
      if (obj.hasOwnProperty(i)) {
        keys.push(i);
      }
    }
    return keys;
  };

  var sortX = function(o) {
    if (isArray(o)) {
        return o.map(sortX);
    } else if (isObject(o)) {
        return keys(o)
            .sort()
            .reduce(function(a, k) {
                a[k] = sortX(o[k]);
                return a;
            }, {});
    }
    return o;
  };

  id = this._id;
  delete this["_id"];
  emit(id, sortX(this));
};

var reduceFunction = function(key,values){
  return values[0];
};

randomVerifier(
  "logging", //loggingDbName
  "admin", //destUsername
  "", //destPassword - can be <string>, <function reference> e.g. passwordPrompt, null will execute passwordPrompt()
  "", //destination connection string (ignores credentials)
  200, //sampleSize 
  1, //partitions
  [""] //databaseWhitelist (optional) - provide null or do not supply parameter to process all dbs
);