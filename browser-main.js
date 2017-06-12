// Example and test case (for browser) for simple locks and condition variables.
//
// We fork off four workers that run long-running loops whose bodies are
// critical sections that update a shared variable.  We also run a loop in a
// fifth worker, but for a shorter time.  The fifth worker waits on a condition
// variable for the other workers to finish, and then posts a message to the
// main thread that it is done - this message contains the word "proxy".
//
// We can't do the waiting on the main thread because the main thread is not
// allowed to perform blocking waits in a browser.  The fifth thread therefore
// serves as a proxy for the main thread.  This is a pretty common pattern.
//
// The attempt here is to stress-test locking, more than anything.

// LOAD THESE FILES FIRST:
//
//   lock.js
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

// Create the proxy, and share memory with it

{
    let w = new Worker("browser-proxy.js");
    w.postMessage([sab, "proxy"]);
    w.onmessage = function (ev) { message(ev.data); }
}

// This is the result we expect

let sum = outer * 3;
for ( let i=0 ; i < numworkers ; i++ )
    sum += inner * (5+i);

function message(m) {
    m = String(m);
    console.log(m);
    if (m.match("proxy")) {
	if (i32[0] == sum)
	    console.log("DONE: " + i32[0]);
	else
	    console.log("FAILED: got " + i32[0] + ", expected " + sum);
    }
}
