// Example and test case (for the SpiderMonkey shell)

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
test[0] = 123456;          // Is it shared?

setSharedArrayBuffer(sab);
Lock.initialize(sab, lockLoc);
Cond.initialize(sab, condLoc);

evalInWorker(`

load("lock.js");
var sab = getSharedArrayBuffer();
${prefix}
assertEq(test[0], 123456); // Is it shared?

for ( var i=0 ; i < inner ; i++ ) {
  lock.lock();
  i32[0] += 5;
  lock.unlock();
}

lock.lock();
msg[0] = 1;
cond.wake();
lock.unlock();
`);

for ( var i=0 ; i < outer ; i++ ) {
  lock.lock();
  i32[0] += 3;
  lock.unlock();
}

let k = 0;
lock.lock();
while (!msg[0]) {
    cond.wait();
    if (k++ > 10)
	break;
}
lock.unlock();

assertEq(i32[0], outer*3 + inner*5);
