// See comments in browser-main.js

importScripts("lock.js", "browser-common-defs.js");

onmessage = function (ev) {
    let [sab, workerID] = ev.data;

    var lock = new Lock(sab, lockLoc);
    var cond = new Cond(lock, condLoc);
    var i32 = new Int32Array(sab, iLoc, 1);
    var msg = new Int32Array(sab, msgLoc, 1);

    for ( let i=0 ; i < inner ; i++ ) {
	lock.lock();
	i32[0] += 5 + workerID;
	lock.unlock();
    }

    lock.lock();
    msg[0]++;
    cond.notifyOne();
    lock.unlock();

    postMessage("Worker " + workerID + " finished");
}
