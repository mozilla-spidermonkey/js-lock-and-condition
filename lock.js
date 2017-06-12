/*
   Copyright 2017 Mozilla Corporation.

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

// Simple, standalone lock and condition variable abstractions.  See README.md
// for a general introduction, shell-test.js for examples, and comments below
// for API specs.
//
// Lock and Cond have no mutable state - all mutable state is in the shared
// memory.

"use strict";

// Private

let _checkParameters = function (sab, loc, truth, who) {
    if (!(sab instanceof SharedArrayBuffer &&
	  loc|0 == loc &&
	  loc >= 0 &&
	  loc % truth.ALIGN == 0 &&
	  loc + truth.NUMBYTES <= sab.byteLength))
    {
	throw new Error("Bad arguments to " + who + ": " + sab + " " + loc);
    }
}

//////////////////////////////////////////////////////////////////////
//
// Locks.
//
// Locks are JS objects that use some shared memory for private data.
//
// The number of shared bytes needed is given by Lock.NUMBYTES, and their
// alignment in the SAB is given by Lock.ALIGN.
//
// The shared memory for a lock should be initialized once by calling
// Lock.initialize() on the memory, before constructing the first Lock object in
// any agent.
//
// Note that you should not call the "lock" and "tryLock" operations on the main
// thread in a browser, because the main thread is not allowed to wait.
//
// Implementation note:
// Lock code taken from http://www.akkadia.org/drepper/futex.pdf.
// Lock states:
//   0: unlocked
//   1: locked with no waiters
//   2: locked with possible waiters

// Initialize shared memory for a lock, before constructing the worker-local
// Lock objects on that memory.
//
// `sab` must be a SharedArrayBuffer.
// `loc` must be a valid index in `sab`, divisible by Lock.ALIGN, and there must
// be space at 'loc' for at least Lock.NUMBYTES.
//
// Returns `loc`.

Lock.initialize = function (sab, loc) {
    _checkParameters(sab, loc, Lock, "Lock initializer");
    Atomics.store(new Int32Array(sab, loc, 1), 0, 0);
    return loc;
}

// Number of shared byte locations needed by the lock.  A multiple of 4.

Lock.NUMBYTES = 4;

// Byte alignment needed by the lock.  A multiple of 4.

Lock.ALIGN = 4;

// Create a lock object.
//
// `sab` must be a SharedArrayBuffer.
// `loc` must be a valid index in `sab`, divisible by Lock.ALIGN, and there must
// be space at 'loc' for at least Lock.NUMBYTES.

function Lock(sab, loc) {
    _checkParameters(sab, loc, Lock, "Lock constructor");
    this.iab = new Int32Array(sab); // View the whole thing so we can share with Cond
    this.ibase = loc >>> 2;
}

// Acquire the lock, or block until we can.  Locking is not recursive: you must
// not hold the lock when calling this.

Lock.prototype.lock = function () {
    const iab = this.iab;
    const stateIdx = this.ibase;
    let c;
    if ((c = Atomics.compareExchange(iab, stateIdx, 0, 1)) != 0) {
        do {
            if (c == 2 || Atomics.compareExchange(iab, stateIdx, 1, 2) != 0)
                Atomics.wait(iab, stateIdx, 2);
        } while ((c = Atomics.compareExchange(iab, stateIdx, 0, 2)) != 0);
    }
}

// Attempt to acquire the lock, return true if it was acquired, false if not.
// Locking is not recursive: you must not hold the lock when calling this.

Lock.prototype.tryLock = function () {
    const iab = this.iab;
    const stateIdx = this.ibase;
    return Atomics.compareExchange(iab, stateIdx, 0, 1) == 0;
}

// Unlock a lock that is held.  Anyone can unlock a lock that is held; nobody
// can unlock a lock that is not held.

Lock.prototype.unlock = function () {
    const iab = this.iab;
    const stateIdx = this.ibase;
    let v0 = Atomics.sub(iab, stateIdx, 1);
    // Wake up a waiter if there are any
    if (v0 != 1) {
        Atomics.store(iab, stateIdx, 0);
        Atomics.wake(iab, stateIdx, 1);
    }
}

Lock.prototype.toString = function () {
    return "{/*Lock*/ loc:" + this.ibase*4 +"}";
}

//////////////////////////////////////////////////////////////////////
//
// Condition variables.
//
// Condition variables are JS objects that use some shared memory for private
// data.
//
// The number of shared bytes needed is given by Cond.NUMBYTES, and their
// alignment in the SAB is given by Cond.ALIGN.
//
// The shared memory for a condition variable should be initialized once by
// calling Cond.initialize() on the memory, before constructing the first Cond
// object in any agent.
//
// Note that you should not call the "wait" operation on the main thread in a
// browser, because the main thread is not allowed to wait.
//
//
// Implementation note:
// The condvar code is based on http://locklessinc.com/articles/mutex_cv_futex,
// though modified because some optimizations in that code don't quite apply.

// Initialize shared memory for a condition variable, before constructing the
// worker-local Cond objects on that memory.
//
// 'sab' must be a SharedArrayBuffer.
// `loc` must be a valid index in `sab`, divisible by Cond.ALIGN, and there must
// be space at 'loc' for at least Cond.NUMBYTES.
//
// Returns 'loc'.

Cond.initialize = function (sab, loc) {
    _checkParameters(sab, loc, Cond, "Cond initializer");
    Atomics.store(new Int32Array(sab, loc, 1), 0, 0);
    return loc;
}

// Create a condition variable that can wait on a lock.
//
// `lock` must be a Lock instance
// `loc` must be a valid index in the shared memory of `lock`, divisible by
// Cond.ALIGN, and there must be space at `loc` for at least Cond.NUMBYTES.

function Cond(lock, loc) {
    _checkParameters(lock instanceof Lock ? lock.iab.buffer : lock, loc, Cond, "Cond constructor");
    this.iab = lock.iab;
    this.ibase = loc >>> 2;
    this.lock = lock;
}

// Number of shared byte locations needed by the condition variable.  A multiple
// of 4.

Cond.NUMBYTES = 4;

// Byte alignment needed by the lock.  A multiple of 4.

Cond.ALIGN = 4;

// Atomically unlock the cond's lock and wait for a wakeup on the cond.  If
// there were waiters on lock then they are woken as the lock is unlocked.
//
// The caller must hold the lock when calling wait().  When wait() returns the
// lock will once again be held.

Cond.prototype.wait = function () {
    const iab = this.iab;
    const seqIndex = this.ibase;
    const seq = Atomics.load(iab, seqIndex);
    const lock = this.lock;
    lock.unlock();
    Atomics.wait(iab, seqIndex, seq);
    lock.lock();
}

// Wakes one waiter on cond.  The cond's lock must be held by the caller of
// wake().

Cond.prototype.wake = function () {
    const iab = this.iab;
    const seqIndex = this.ibase;
    Atomics.add(iab, seqIndex, 1);
    Atomics.wake(iab, seqIndex, 1);
}

// Wakes all waiters on cond.  The cond's lock must be held by the caller of
// wakeAll().

Cond.prototype.wakeAll = function () {
    const iab = this.iab;
    const seqIndex = this.ibase;
    Atomics.add(iab, seqIndex, 1);
    Atomics.wake(iab, seqIndex);
}

Cond.prototype.toString = function () {
    return "{/*Cond*/ loc:" + this.ibase*4 +" lock:" + this.lock + "}";
}
