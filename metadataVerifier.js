metaDataVerifier = function (loggingDbName,
                          destUsername,
                          destPassword,
                          destConnString, 
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
  jobCollName = "job";
  logCollName = "log";

  runId = ObjectId();
  print("*** Starting new run with id " + runId.toString());
  loggingDb.getCollection(jobCollName).insert({_id: runId, verificationType: "meta-data", start: ISODate()});
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

    if (d.name !== 'admin' && d.name != 'local') {
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
  
          srcInfo = {}

          srcCollectionInfo = sourceDB.getSiblingDB(d.name).getCollectionInfos({name: c.name})[0]
          srcInfo.options = srcCollectionInfo.options;

          srcIdx = sourceDB.getSiblingDB(d.name).getCollection(c.name).getIndexes()
          if (srcIdx && Array.isArray(srcIdx)){
            for (i = 0; i < srcIdx.length; i++){
              if (srcIdx[i].ns) {
                delete srcIdx[i].ns
              }
              if (srcIdx[i].v) {
                delete srcIdx[i].v
              }
            }
          }
          srcInfo.idx = srcIdx;
          

          dstInfo = {};
          dstCollectionInfo = destDB.getSiblingDB(d.name).getCollectionInfos({name: c.name})
          if (dstCollectionInfo.length > 0){
            dstInfo.options = dstCollectionInfo[0].options;

            dstIdx = destDB.getSiblingDB(d.name).getCollection(c.name).getIndexes()

            if (dstIdx && Array.isArray(dstIdx)){
             for (i = 0; i < dstIdx.length; i++){
                print(i)
                if (dstIdx[i].ns) {
                  delete dstIdx[i].ns
                }
                if (dstIdx[i].v) {
                  delete dstIdx[i].v
                }
              }
            }
            dstInfo.idx = dstIdx;
          }

          srcInfo = sortX(srcInfo);
          dstInfo = sortX(dstInfo);
          
          matched = JSON.stringify(srcInfo) === JSON.stringify(dstInfo);
          
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
            verificationType: "meta-data",
            start : collStartDate,
            end : ISODate(),
            srcInfo : srcInfo,
            dstInfo : dstInfo,
            matched : matched
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
    print("   Note, you can further filter using the namespace ns e.g. ...");
    print("   use " + loggingDbName);
    print("   db." + logCollName + ".find({runId: " + runId.toString() + ", matched: false, ns: <namespace>}).pretty()");
    print("*** ")
  }

}

var isObject = function(v) {
      return '[object Object]' === Object.prototype.toString.call(v)
          || '[object BSON]' === Object.prototype.toString.call(v);
  };

var sortX = function(o) {
    if (Array.isArray(o)) {
        return o.map(sortX);
    } else if (isObject(o)) {
        return Object.keys(o)
            .sort()
            .reduce(function(a, k) {
                a[k] = sortX(o[k]);
                return a;
            }, {});
    }
    return o;
  };

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
            verificationType: "meta-data",
            start : collStartDate,
            end : collStartDate,
          }
  loggingDb.getCollection(logCollName).insert(resultDoc);
}

metaDataVerifier(
  "logging", //loggingDbName
  "admin", //destUsername
  "", //destPassword - can be <string>, <function reference> e.g. passwordPrompt, null will execute passwordPrompt()
  "", //destination connection string (ignores credentials)
  [""] //databaseWhitelist (optional) - provide null or do not supply parameter to process all dbs
);
