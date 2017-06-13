# Simple Lock and Condition Variable Library for JavaScript with SharedArrayBuffer and Atomics

Locks and condition variables are basic abstractions that let concurrent programs coordinate access to shared memory.  This library provides simple implementations of two types, `Lock` and `Cond`, that will be sufficient for many concurrent JS programs.

Both `Lock` and `Cond` are JS objects that use a little shared memory for coordination.  You can pass them around as you would pass around any JS value, and they have no mutable state - all mutable state is in the shared memory.

## Usage

Instances of `Lock` and `Cond` are variables in shared memory, and you must yourself manage the storage for them.  Suppose you have a `SharedArrayBuffer` called `sab` and you want to allocate a `Lock` variable.  You must decide where in `sab` your new variable is going to reside, let's call this index `loc`.  The index must be divisible by `Lock.ALIGN` (which is at least 4), and the variable must have exclusive access to `Lock.NUMBYTES` bytes (this property value is at least 4) starting at `loc`.

Now that you've allocated storage you must initialize it.  *One* agent must call `Lock.initialize(sab, loc)` to initialize the memory.  It must do this before any agent uses that memory for a lock.  (The simplest way to ensure that memory is properly initialized before any agent uses it is to initialize the memory before the `SharedArrayBuffer` is shared with other agents.)

Once the memory has been initialized you can create a new `Lock` object on it:
```js
let lock = new Lock(sab, loc);
```
If you create a new `Lock` on the same memory in multiple agents, then the agents can use that lock to coordinate access to shared memory.  If two agents call the lock's `lock` method at the same time, only one of them will be allowed to proceed; the other will be blocked until the agent that obtained the lock releases it with a call to the lock's `unlock` method.  If both agents attempt to execute the following code, all reads and writes in one agent will be done before all reads and writes in the other:
```js
let i32 = new Int32Array(sab)
...
lock.lock()
i32[1] = i32[2] + i32[3];
i32[0] += 1
lock.unlock()
```

While the `Lock` and `Cond` objects themselves will be garbage collected (because they are just JS values), you must yourself determine when the shared memory used for a lock variable may be reused for something else.  In many programs, you'll just allocate space for the locks and condition variables at the start of the program and never worry about reusing it.

## API

Here's a synopsis.  For more information, see comments in [lock.js](lock.js).  For an example of the use, see [browser-test.html](browser-test.html) for code for a web browser, or [shell-test.js](shell-test.js) for code for a JavaScript shell.

### Lock

* `Lock.initialize(sab, loc)` initializes a lock variable in the shared memory
* `Lock.ALIGN` is the required byte alignment for a lock variable
* `Lock.NUMBYTES` is the required storage allocation for a lock variable (always divisible by Lock.ALIGN)
* `new Lock(sab, loc)` creates an agent-local lock object on the lock variable in shared memory
* `Lock.prototype.lock()` acquires a lock, blocking until it is available if necessary.  Locks are not recursive: an agent must not attempt to lock a lock that it is already holding
* `Lock.prototype.tryLock()` acquires a lock (as if by `Lock.prototype.lock`) if it is available and if so returns `true`; otherwise does nothing and returns `false`
* `Lock.prototype.unlock()` releases the lock.  An agent must not unlock a lock that is not acquired, though it need not have acquired the lock itself

### Cond

* `Cond.initialize(sab, loc)` initializes a condition variable in the shared memory
* `Cond.ALIGN` is the required byte alignment for a condition variable
* `Cond.NUMBYTES` is the required storage allocation for a condition variable (always divisible by Cond.ALIGN)
* `new Cond(lock, loc)` creates an agent-local condition-variable object on the condition variable in shared memory, for a given lock.  Here the `lock` is a `Lock` object; the condition variable must be in the same memory as the lock.  The `lock` property of the new `Cond` object references that lock
* `Cond.prototype.wait()` waits on a condition variable.  The condition variable's lock must be held when calling this
* `Cond.prototype.wakeOne()` wakes a single waiter on a condition variable.  The condition variable's lock must be held when calling this
* `Cond.prototype.wakeAll()` wakes all waiters on a condition variable.  The condition variable's lock must be held when calling this

## Limitations

Web browsers will not allow JS code running on the "main" thread of a window to block, so `Lock.prototype.lock`, `Lock.prototype.tryLock`, and `Cond.prototype.wait` cannot in general be called on the window's main thread.  The main thread can still call eg `Lock.prototype.unlock`, `Cond.prototype.wake`, and `Cond.prototype.wakeAll`.
