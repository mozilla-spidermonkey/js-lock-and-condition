// Example and test case (for the SpiderMonkey shell)
//
// We fork off four workers that run long-running loops whose bodies are
// critical sections that update a shared variable.  We also run a loop in the
// main thread, but for a shorter time.  The main thread waits on a condition
// variable for all the workers to finish.
//
// The attempt here is to stress-test locking, more than anything.

var numworkers = 4;

var prefix =
`
// Locations in the SAB for the various data
var lockLoc = 64;
var condLoc = 1024;
var testLoc = 2048;
var iLoc = 100;
var msgLoc = 200;

// parameters
var inner = 10000000;
var outer = 100000;

// data structures
var lock = new Lock(sab, lockLoc);
var cond = new Cond(lock, condLoc);
var i32 = new Int32Array(sab, iLoc, 1);
var msg = new Int32Array(sab, msgLoc, 1);
var test = new Int32Array(sab, testLoc, 1);
`;

load("lock.js");
var sab = new SharedArrayBuffer(4096);
eval(prefix);
test[0] = 123456;          // Workers will look at this

setSharedArrayBuffer(sab);
Lock.initialize(sab, lockLoc);
Cond.initialize(sab, condLoc);

for ( let i=0 ; i < numworkers ; i++ ) {
    evalInWorker(`

load("lock.js");
var sab = getSharedArrayBuffer();
var workerID = ${i};
${prefix}
assertEq(test[0], 123456); // Test that memory was shared properly

for ( let i=0 ; i < inner ; i++ ) {
  lock.lock();
  i32[0] += 5 + workerID;
  lock.unlock();
}

lock.lock();
msg[0]++;
cond.wake();
lock.unlock();
`);

}

for ( let i=0 ; i < outer ; i++ ) {
  lock.lock();
  i32[0] += 3;
  lock.unlock();
}

lock.lock();
while (msg[0] < numworkers)
    cond.wait();
lock.unlock();

let sum = outer * 3;
for ( let i=0 ; i < numworkers ; i++ )
    sum += inner*(5+i);

assertEq(i32[0], sum);
