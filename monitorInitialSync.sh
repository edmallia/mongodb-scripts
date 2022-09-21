#!/bin/bash
while sleep 30; do
        date
        TIME=`mongosh --quiet --eval 'db.adminCommand({ replSetGetStatus: 1, initialSync: 1 }).initialSyncStatus.remainingInitialSyncEstimatedMillis/1000/60'`
        echo "Est Time remaining: $TIME"
        TX=`mongosh --quiet --eval 'i = db.adminCommand({ replSetGetStatus: 1, initialSync: 1 }).initialSyncStatus; (i.approxTotalBytesCopied/1024/1024)/(i.totalInitialSyncElapsedMillis/1000)'`
        echo "Est transfer rate:  $TX"
        echo "================================================="
done
