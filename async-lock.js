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

"use strict";

// Addition to lock.js that allows waiting on the browser's main thread using
// async/await or Promise patterns.
//
// REQUIRES
//    lock.js (must be loaded first)

// await this on the main thread.  When the await completes, the lock will be held.

Lock.prototype.asyncLock = async function() {
    const iab = this._iab;
    const stateIdx = this._ibase;
    let c;
    if ((c = Atomics.compareExchange(iab, stateIdx, 0, 1)) != 0) {
        do {
            if (c == 2 || Atomics.compareExchange(iab, stateIdx, 1, 2) != 0)
                await Atomics.waitNonblocking(iab, stateIdx, 2);
        } while ((c = Atomics.compareExchange(iab, stateIdx, 0, 2)) != 0);
    }
}

// await this on the main thread.  When the await completes, the condition will
// have received a signal and will have re-acquired the lock.

Cond.prototype.asyncWait = async function () {
    const iab = this._iab;
    const seqIndex = this._ibase;
    const seq = Atomics.load(iab, seqIndex);
    const lock = this.lock;
    lock.unlock();
    await Atomics.waitNonblocking(iab, seqIndex, seq);
    await lock.asyncLock();
}

/* Polyfill for Atomics.waitNonblocking() for web browsers, copied from
 * https://github.com/tc39/proposal-atomics-wait-async, relicensed by author for
 * this library.
 */
;(function () {
    let helperCode = `
    onmessage = function (ev) {
    	try {
    	    switch (ev.data[0]) {
    	    case 'wait': {
    		let [_, ia, index, value, timeout] = ev.data;
    		let result = Atomics.wait(ia, index, value, timeout)
    		postMessage(['ok', result]);
    		break;
    	    }
    	    default:
    		throw new Error("Bogus message sent to wait helper: " + e);
    	    }
    	} catch (e) {
    	    console.log("Exception in wait helper");
    	    postMessage(['error', 'Exception']);
    	}
    }
    `;

    let helpers = [];

    function allocHelper() {
    	if (helpers.length > 0)
    	    return helpers.pop();
    	let h = new Worker("data:application/javascript," + encodeURIComponent(helperCode));
    	return h;
    }

    function freeHelper(h) {
    	helpers.push(h);
    }

    // Don't load it if it's already there

    if (typeof Atomics.waitNonblocking == "function")
     	return;

    // Atomics.waitNonblocking always returns a promise.  Throws standard errors
    // for parameter validation.  The promise is resolved with a string as from
    // Atomics.wait, or, in the case something went completely wrong, it is
    // rejected with an error string.

    Atomics.waitNonblocking = function (ia, index_, value_, timeout_) {
    	if (typeof ia != "object" || !(ia instanceof Int32Array) || !(ia.buffer instanceof SharedArrayBuffer))
    	    throw new TypeError("Expected shared memory");

    	// These conversions only approximate the desired semantics but are
    	// close enough for the polyfill.

    	let index = index_|0;
    	let value = value_|0;
    	let timeout = timeout_ === undefined ? Infinity : +timeout_;

    	// Range checking for the index.

    	ia[index];

    	// Optimization, avoid the helper thread in this common case.

    	if (Atomics.load(ia, index) != value)
    	    return Promise.resolve("not-equal");

    	// General case, we must wait.

    	return new Promise(function (resolve, reject) {
    	    let h = allocHelper();
    	    h.onmessage = function (ev) {
    		// Free the helper early so that it can be reused if the resolution
    		// needs a helper.
    		freeHelper(h);
    		switch (ev.data[0]) {
    		case 'ok':
    		    resolve(ev.data[1]);
    		    break;
    		case 'error':
    		    // Note, rejection is not in the spec, it is an artifact of the polyfill.
    		    // The helper already printed an error to the console.
    		    reject(ev.data[1]);
    		    break;
    		}
    	    }

    	    // It's possible to do better here if the ia is already known to the
    	    // helper.  In that case we can communicate the other data through
    	    // shared memory and wake the agent.  And it is possible to make ia
    	    // known to the helper by waking it with a special value so that it
    	    // checks its messages, and then posting the ia to the helper.  Some
    	    // caching / decay scheme is useful no doubt, to improve performance
    	    // and avoid leaks.
    	    //
    	    // In the event we wake the helper directly, we can micro-wait here
    	    // for a quick result.  We'll need to restructure some code to make
    	    // that work out properly, and some synchronization is necessary for
    	    // the helper to know that we've picked up the result and no
    	    // postMessage is necessary.

    	    h.postMessage(['wait', ia, index, value, timeout]);
    	})
    }
})();
