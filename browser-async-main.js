// Example and test case (for browser) for async locks and condition variables.
//
// We fork off four workers that run long-running loops whose bodies are
// critical sections that update a shared variable.  We also run a loop in the
// main thread, but for a shorter time.  The main thread then waits on a condition
// variable for the other workers to finish.
//
// We can do the waiting on the main thread because we use asynchronous waits.
//
// Also see browser-main.js for the similar code without the async waits.

// LOAD THESE FILES FIRST:
//
//   lock.js
//   async-main.js
//   browser-common-defs.js

// Create shared memory

var sab = new SharedArrayBuffer(4096);

// Initialize shared memory - happens only here

Lock.initialize(sab, lockLoc);
Cond.initialize(sab, condLoc);

// Create our local views on shared memory.

var lock = new Lock(sab, lockLoc);
var cond = new Cond(lock, condLoc);
var i32 = new Int32Array(sab, iLoc, 1);
var msg = new Int32Array(sab, msgLoc, 1);

// Create the workers, and share memory with them

for ( let i=0; i < numworkers ; i++ ) {
    let w = new Worker("browser-worker.js");
    w.postMessage([sab, i]);
    w.onmessage = function (ev) { message(ev.data); }
}

// A more reasonable main loop count.

outer *= 3;

async function mainloop() {
    for ( let i=0 ; i < outer ; i++ ) {
	await lock.asyncLock();
	i32[0] += 3;
	lock.unlock();
    }

    message("Main thread waiting now");
    await lock.asyncLock();
    while (msg[0] < numworkers)
	await cond.asyncWait();
    lock.unlock();
}

// Let the workers start.  100ms delay lets the workers get going before we run
// through our short loop.  Often you should see the main thread's "waiting now"
// message mixed in "finished" messages from the workers.

setTimeout(async function() {
    await mainloop();
    message("proxy");
}, 100);

// The result we expect

let sum = outer * 3;
for ( let i=0 ; i < numworkers ; i++ )
    sum += inner * (5+i);

function message(m) {
    m = String(m);
    document.getElementById("scrool").innerHTML += m + "<br>";
    if (m.match("proxy")) {
	if (i32[0] == sum)
	    message("DONE: " + i32[0]);
	else
	    message("FAILED: got " + i32[0] + ", expected " + sum);
    }
}
