// Copyright 2015, 2016 Parity Technologies (UK) Ltd.
// This file is part of Parity.

// Parity is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// Parity is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with Parity.  If not, see <http://www.gnu.org/licenses/>.

/* global chrome */

import Ws from './ws';
import { UI, TRANSPORT_UNINITIALIZED, EV_WEB3_ACCOUNTS_REQUEST, EV_TOKEN, getRetryTimeout } from '../shared';

let openedTabId = null;
let transport = null;
// Attempt to extract token on start if not available.
extractToken();

export default function secureApiMessage (port) {
  return (msg) => {
    const { id, payload } = msg;
    if (!transport || !transport.isConnected) {
      console.error('Transport uninitialized!');
      port.postMessage({
        id, err: TRANSPORT_UNINITIALIZED,
        payload: null,
        connected: false
      });
      return;
    }

    transport.executeRaw(payload)
      .then((response) => {
        port.postMessage({
          id,
          err: null,
          payload: response,
          connected: true
        });
      })
      .catch((err) => {
        port.postMessage({
          id,
          err,
          payload: null
        });
      });
  };
}

let accountsCache = {};
function newTransport (token) {
  const transport = new Ws(`ws://${UI}`, token, true);
  transport.on('open', () => {
    accountsCache = {};
  });
  return transport;
}

chrome.runtime.onMessage.addListener((request, sender, callback) => {
  const isTransportReady = transport && transport.isConnected;

  if (request.type === EV_WEB3_ACCOUNTS_REQUEST) {
    if (!isTransportReady) {
      return callback({
        err: TRANSPORT_UNINITIALIZED
      });
    }

    const { origin } = request;
    if (accountsCache[origin]) {
      return callback({
        err: null,
        payload: accountsCache[origin]
      });
    }

    transport.execute('parity_getDappsAddresses', origin)
      .then(accounts => {
        accountsCache[origin] = accounts;
        return callback({
          err: null,
          payload: accounts
        });
      })
      .catch(err => callback({
        err,
        payload: null
      }));
  }

  if (request.type !== EV_TOKEN) {
    return;
  }

  if (!isTransportReady && request.token) {
    if (transport) {
      // TODO [ToDr] kill old transport!
    }

    if (openedTabId) {
      chrome.tabs.remove(openedTabId);
      openedTabId = null;
    }

    console.log('Extracted a token: ', request.token);
    console.log('Extracted backgroundSeed: ', request.backgroundSeed);
    chrome.storage.local.set({
      'authToken': request.token,
      'backgroundSeed': request.backgroundSeed
    }, () => {});
    transport = newTransport(request.token);
    return;
  }
});

function extractToken () {
  chrome.storage.local.get('authToken', (token) => {
    if (!token.authToken) {
      fetch(`http://${UI}`)
        .then(() => {
          // Open a UI to extract the token from it
          chrome.tabs.create({
            url: `http://${UI}`,
            active: false
          }, (tab) => {
            openedTabId = tab.id;
          });
          extractToken.retries = 0;
        })
        .catch(err => {
          console.error('Node seems down, will re-try', err);
          extractToken.retries += 1;
          setTimeout(() => extractToken(), getRetryTimeout(extractToken.retries));
        });
      return;
    }

    transport = newTransport(token.authToken);
  });
}
extractToken.retries = 0;