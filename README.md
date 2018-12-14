# Simple Lock and Condition Variable Library for JavaScript with SharedArrayBuffer and Atomics

Locks and condition variables are basic abstractions that let concurrent programs coordinate access to shared memory.  This library provides simple implementations of two types, `Lock` and `Cond`, that will be sufficient for many concurrent JS programs.

Both `Lock` and `Cond` are JS objects that use a little shared memory for coordination.  You can pass these objects around as you would pass around any other JS value, and the objects themselves have no mutable state - all the mutable state is in the shared memory.  The objects can therefore be serialized and deserialized, and can be sent by `postMessage` between workers if that's your thing.

## Usage

To use the locking library, first load `"lock.js"`.

### Managing the shared memory

Each instance of `Lock` and `Cond` needs to have private use of a few bytes of shared memory, and you must yourself manage the shared storage for them.  Suppose you have created a `SharedArrayBuffer` called `sab` and you want to allocate space for a `Lock` object.  You must decide where in `sab` this space is going to allocated, let's call this index `loc`.  The index `loc` must be divisible by `Lock.ALIGN`, and the space that is needed is `Lock.NUMBYTES` bytes, starting at `loc`.  (It's the same for `Cond`, only with `Cond.ALIGN` and `Cond.NUMBYTES`.)

Now that you've allocated shared storage you must initialize it.  *One* agent must call `Lock.initialize(sab, loc)` to initialize the memory for the lock.  It must perform the initialization before any agent uses that memory for a JS lock object.  (The simplest way to ensure that memory is properly initialized before any agent uses it is to initialize the memory before `sab` is shared with other agents.)

Space for a `Cond` is initialized in the same way.  Note that a `Cond` is always used with a `Lock` and that the pair must be constructed on the same `SharedArrayBuffer` instance.

### Creating JS values on the shared memory

Once the shared memory has been initialized you can create a new `Lock` object on it:
```js
let lock = new Lock(sab, loc);
```
If you create a new `Lock` on the same shared memory area in multiple agents, then the agents can use that lock to coordinate access to any part of shared memory.  If two agents call the lock's `lock` method at the same time, only one of them will be allowed to proceed; the other will be blocked until the agent that first obtained the lock releases it with a call to the lock's `unlock` method.  If both agents attempt to execute the following code, all reads and writes in one agent will be done before all reads and writes in the other:
```js
let i32 = new Int32Array(sab)
...
lock.lock()
i32[1] = i32[2] + i32[3];
i32[0] += 1
lock.unlock()
```

While the `Lock` and `Cond` objects themselves will be garbage collected (because they are just JS values), you must yourself determine when the shared memory used by those objects may be reused for something else.  This is often hard, and in many programs, you'll just allocate shared memory for the locks and condition variables at the start of the program and never worry about reusing it.

## API

Here's a synopsis of the API.  For more information, see comments in [lock.js](lock.js).  For an example of the use, see [browser-test.html](browser-test.html) for code for a web browser, or [shell-test.js](shell-test.js) for code for a JavaScript shell.

### Lock

* `Lock.initialize(sab, loc)` initializes a lock variable in the shared memory
* `Lock.ALIGN` is the required byte alignment for a lock variable
* `Lock.NUMBYTES` is the required storage allocation for a lock variable (always divisible by Lock.ALIGN)
* `new Lock(sab, loc)` creates an agent-local lock object on the lock variable in shared memory
* `Lock.prototype.lock()` acquires a lock, blocking until it is available if necessary.  Locks are not recursive: an agent must not attempt to lock a lock that it is already holding.  This method does not work on the browser's main thread; see below
* `Lock.prototype.tryLock()` acquires a lock (as if by `Lock.prototype.lock`) if it is available and if so returns `true`; otherwise does nothing and returns `false`
* `Lock.prototype.unlock()` releases the lock.  An agent must not unlock a lock that is not acquired, though it need not have acquired the lock itself
* `Lock.prototype.serialize()` returns an Object with a field `isLockObject` that is true, and other enumerable fields.  This Object can be transmitted eg by `postMessage`
* `Lock.deserialize(r)` creates a `Lock` object from a serialized representation `r`

### Cond

* `Cond.initialize(sab, loc)` initializes a condition variable in the shared memory
* `Cond.ALIGN` is the required byte alignment for a condition variable
* `Cond.NUMBYTES` is the required storage allocation for a condition variable (always divisible by Cond.ALIGN)
* `new Cond(lock, loc)` creates an agent-local condition-variable object on the condition variable in shared memory, for a given lock.  Here the `lock` is a `Lock` object; the condition variable must be in the same memory as the lock.  The `lock` property of the new `Cond` object references that lock
* `Cond.prototype.wait()` waits on a condition variable.  The condition variable's lock must be held when calling this.  This method does not work on the browser's main thread; see below
* `Cond.prototype.notifyOne()` notifies a single waiter on a condition variable.  The condition variable's lock must be held when calling this
* `Cond.prototype.notifyAll()` notifies all waiters on a condition variable.  The condition variable's lock must be held when calling this
* `Cond.prototype.serialize()` returns an Object with a field `isCondObject` that is true, and other enumerable fields.  This Object can be transmitted eg by `postMessage`
* `Cond.deserialize(r)` creates a `Cond` object from a serialized representation `r`

## Locking and waiting on the browser's main thread

Web browsers will not allow JS code running on the "main" thread of a window to block, so `Lock.prototype.lock()` and `Cond.prototype.wait()` cannot in general be called on the window's main thread (if you call them, they will throw exceptions).  The main thread can still call `Lock.prototype.tryLock()`, `Lock.prototype.unlock()`, `Cond.prototype.notifyOne()`, and `Cond.prototype.notifyAll()`.

However, by also loading the file `"async-lock.js"` you get access to two additional methods:

* `Lock.prototype.asyncLock()` may eventually obtain the lock but will not block in the mean time.  You `await` a call to this method on the main thread instead of calling `Lock.prototype.lock`, and when the `await` completes the lock is acquired
* `Cond.prototype.asyncWait()` may eventually receive a notification but will not block in the mean time.  You `await` a call to this on the main thread instead of calling `Cond.prototype.wait()`, and when the `await` completes the condition variable has been notified and the lock has been re-acquired

The example from above would look like this:
```js
async function f() {
   ...
   await lock.asyncLock()
   i32[1] = i32[2] + i32[3];
   i32[0] += 1
   lock.unlock()
   ...
}
```
See [browser-async-test.html](browser-async-test.html) for some demo and test code.  The async methods can be used in Workers as well, but are less useful there.

## Limitations, etc

`Lock` and `Cond` are meant to be easy to understand and easy to work with; higher performance locks are possible.

The `asyncLock` and `asyncWait` methods use a fairly expensive implementation and in addition make use of the browser's promise resolution machinery, which is relatively expensive.  These methods are probably quite slow in practice, but they do allow the main thread to communicate reliably through shared memory with its workers.

The library is only intended to work with the new `SharedArrayBuffer` and `Atomics` objects in ECMAScript 2017.  Polyfills are not desirable, and, in the case of shared memory, scarcely possible.
