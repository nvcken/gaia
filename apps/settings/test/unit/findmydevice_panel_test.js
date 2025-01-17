/* global MocksHelper */
/* global HtmlImports */
/* global MockSettingsListener */
/* global MockSettingsHelper */
/* global MockLazyLoader */
/* global IAC_API_WAKEUP_REASON_TRY_DISABLE */

'use strict';

// require helpers for managing html
require('/shared/js/component_utils.js');
require('/shared/elements/gaia_switch/script.js');
require('/shared/test/unit/load_body_html_helper.js');
require('/shared/js/html_imports.js');

require('/shared/test/unit/mocks/mocks_helper.js');
require('/shared/test/unit/mocks/mock_settings_listener.js');
require('/shared/test/unit/mocks/mock_settings_helper.js');
require('/shared/test/unit/mocks/mock_lazy_loader.js');
require('/shared/js/findmydevice_iac_api.js');

var mocksForFindMyDevice = new MocksHelper([
  'SettingsListener', 'SettingsHelper', 'LazyLoader'
]).init();

suite('Find My Device panel > ', function() {
  var MockMozId, realMozId;
  var subject;
  var signinSection, settingsSection, trackingSection, login, loginButton,
      checkbox, unverifiedError;

  mocksForFindMyDevice.attachTestHelpers();

  setup(function(done) {
    realMozId = navigator.mozId;
    MockMozId = {
      onlogin: null,
      onlogout: null,
      onready: null,
      onerror: null,
      oncancel: null,

      watch: function(options) {
        this.onlogin = options.onlogin;
        this.onlogout = options.onlogout;
        this.onready = options.onready;
        this.onerror = options.onerror;

        setTimeout(function() {
          options.onready();
        });
      },

      request: function(options) {
        this.oncancel = options.oncancel;
      },
    };

    navigator.mozId = MockMozId;

    this.sinon.stub(MockLazyLoader, 'getJSON', function() {
      return Promise.resolve({});
    });

    // first, load settings app
    loadBodyHTML('/index.html');

    // next, insert fmd panel into page
    var importHook = document.createElement('link');
    importHook.setAttribute('rel', 'import');
    importHook.setAttribute('href', '/elements/findmydevice.html');
    document.head.appendChild(importHook);
    HtmlImports.populate(function onDOMReady() {
      // double-check panel is ready
      if (document.getElementById('findmydevice-signin') == null) {
        throw new Error('failed to load findmydevice panel into page');
      }

      // grab pointers to useful elements
      signinSection = document.getElementById('findmydevice-signin');
      settingsSection = document.getElementById('findmydevice-settings');
      trackingSection = document.getElementById('findmydevice-tracking');
      checkbox = document.querySelector('#findmydevice-enabled gaia-switch');
      login = document.getElementById('findmydevice-login');
      loginButton = document.querySelector('#findmydevice-login > button');
      unverifiedError = document.getElementById(
        'findmydevice-fxa-unverified-error');

      // manually enable the loginButton
      loginButton.removeAttribute('disabled');

      // Define a map so that we can replace the module with a mock.
      var map = {
        '*': {
          'modules/settings_utils': 'MockSettingsUtils',
          'shared/settings_listener': 'MockSettingsListener'
        }
      };

      // Define the mock for replacing "modules/settings_utils".
      define('MockSettingsUtils', function() {
        return {
          runHeaderFontFit: function() {}
        };
      });

      // Define the mock for replacing "shared/settings_listener".
      define('MockSettingsListener', function() {
        return MockSettingsListener;
      });

      // Create a new require context for defining the mock and requiring.
      var requireCtx = testRequire([], map, function() {});

      require('/js/findmydevice.js', function() {
        // Use the context to require the module for testing
        requireCtx(['findmydevice'], function(FindMyDevice) {
          subject = FindMyDevice;
          subject.init();
          // Ensure promise is resolved and FindMyDevice.init()
          // is finished before tests start
          MockLazyLoader.getJSON.getCall(0).returnValue.then(
            function() { done(); });
        });
      });
    });
  });

  test('prompt for login when logged out of FxA', function() {
    MockSettingsListener.mCallbacks['findmydevice.logged-in'](false);
    assert.isFalse(signinSection.hidden);
    assert.isTrue(settingsSection.hidden);
  });

  test('consider ourselves logged out if onerror fires when not offline',
  function() {
    MockMozId.onerror('{"name": "NOT_OFFLINE"}');
    assert.isFalse(
      MockSettingsHelper.instances['findmydevice.logged-in'].value);
  });

  test('persist panel if onerror fires due to being offline', function() {
    MockSettingsListener.mCallbacks['findmydevice.logged-in'](true);
    MockMozId.onerror('{"name": "OFFLINE"}');
    assert.isFalse(settingsSection.hidden);
    assert.isTrue(signinSection.hidden);

    MockSettingsListener.mCallbacks['findmydevice.logged-in'](false);
    MockMozId.onerror('{"name": "OFFLINE"}');
    assert.isTrue(settingsSection.hidden);
    assert.isFalse(signinSection.hidden);
  });

  test('show settings when logged in to FxA', function() {
    MockSettingsListener.mCallbacks['findmydevice.logged-in'](true);
    assert.isFalse(settingsSection.hidden);
    assert.isTrue(signinSection.hidden);
  });

  test('ignore clicks when button is disabled', function() {
    loginButton.disabled = true;
    var onLoginClickSpy = sinon.spy(subject, '_onLoginClick');
    loginButton.click();
    sinon.assert.notCalled(onLoginClickSpy);
    subject._onLoginClick.restore();
  });

  test('enable button after watch fires onready', function() {
    loginButton.disabled = true;
    MockMozId.onready();
    assert.isFalse(!!loginButton.disabled);
  });

  test('enable button after watch fires onerror', function() {
    loginButton.disabled = true;
    MockMozId.onerror('{"name": "NOT_OFFLINE"}');
    assert.isFalse(!!loginButton.disabled);
  });

  test('auto-enable if not registered when logging in using the login button',
  function(done) {
    MockSettingsHelper('findmydevice.registered').set(false);

    MockMozId.onlogout();
    loginButton.click();
    MockMozId.onlogin();

    MockSettingsHelper('findmydevice.enabled').get(function(enabled) {
      assert.isTrue(enabled);
      done();
    });
  });

  test('don\'t auto-enable if registered when logging in with the login button',
  function() {
    MockSettingsHelper('findmydevice.registered').set(true);

    MockMozId.onlogout();
    loginButton.click();
    MockMozId.onlogin();

    assert.isUndefined(
      MockSettingsHelper.instances['findmydevice.enabled'].value);
  });

  test('bug 997310 - don\'t disable on non-interactive login', function() {
    MockMozId.onlogin();
    var nLocks = MockSettingsListener.getSettingsLock().locks.length;
    assert.equal(nLocks, 0, 'set no settings on non-interactive login');
  });

  test('notify in settings panel when phone is tracked', function() {
    MockSettingsListener.mCallbacks['findmydevice.enabled'](false);
    assert.isTrue(trackingSection.hidden);
    MockSettingsListener.mCallbacks['findmydevice.enabled'](true);
    assert.isFalse(trackingSection.hidden);

    MockSettingsListener.mCallbacks['findmydevice.tracking'](true);
    assert.equal(trackingSection.getAttribute('data-l10n-id'),
                                              'findmydevice-active-tracking');
    MockSettingsListener.mCallbacks['findmydevice.tracking'](false);
    assert.equal(trackingSection.getAttribute('data-l10n-id'),
                                              'findmydevice-not-tracking');
  });

  test('prevent accidental auto-enable on FxA sign-in', function() {
    MockMozId.onlogout();
    loginButton.click();
    assert.equal(true, subject._interactiveLogin,
      'ensure _interactiveLogin is true after login button is clicked');
    MockMozId.oncancel();
    assert.equal(false, subject._interactiveLogin,
      'ensure _interactiveLogin is false after FxA cancel');
    MockMozId.onlogin();
    assert.equal(0, MockSettingsListener.getSettingsLock().locks.length,
      'ensure findmydevice.enabled was not set automatically on FxA login');
  });

  test('disallow changes when findmydevice.can-disable is false', function() {
    MockSettingsListener.mCallbacks['findmydevice.can-disable'](false);
    assert.isTrue(checkbox.disabled,
      'checkbox is not disabled while findmydevice.can-disable is false');
    MockSettingsListener.mCallbacks['findmydevice.can-disable'](true);
    assert.isFalse(checkbox.disabled,
      'checkbox is disabled while findmydevice.can-disable is true');
  });

  test('wake up find my device upon a disable attempt', function() {
    this.sinon.stub(window, 'wakeUpFindMyDevice');
    checkbox.checked = true;

    var event = new CustomEvent('click', {
      bubbles: true,
      cancelable: true
    });
    checkbox.querySelector('label').dispatchEvent(event);

    assert.ok(window.wakeUpFindMyDevice.calledWith(
        IAC_API_WAKEUP_REASON_TRY_DISABLE));
    window.wakeUpFindMyDevice.reset();
  });

  test('hide error message for unverified account by default', function() {
    assert.isTrue(unverifiedError.hidden);
  });

  test('don\'t display error message for unverified account when offline',
  function() {
    MockMozId.onerror('{"name": "OFFLINE"}');
    assert.isTrue(unverifiedError.hidden);
  });

  test('display error message for unverified accounts', function() {
    MockMozId.onerror('{"name": "UNVERIFIED_ACCOUNT"}');
    assert.isFalse(unverifiedError.hidden);
    assert.isTrue(login.hidden);
  });

  test('hide error message for unverified accounts on login',
  function() {
    unverifiedError.hidden = false;
    login.hidden = true;

    MockMozId.onlogin();
    assert.isTrue(unverifiedError.hidden);
    assert.isFalse(login.hidden);
  });

  test('hide error message for unverified accounts on logout',
  function() {
    unverifiedError.hidden = false;
    login.hidden = true;

    MockMozId.onlogout();
    assert.isTrue(unverifiedError.hidden);
    assert.isFalse(login.hidden);
  });

  teardown(function() {
    navigator.mozId = realMozId;
  });

  suite('mozId login/logout forces logged-in setting value', function() {
    var loggedIn = 'findmydevice.logged-in';
    setup(function() {
      MockSettingsHelper(loggedIn).set(null);
    });

    test('onlogin(true)', function(done) {
      MockMozId.onlogin(true);
      MockSettingsHelper(loggedIn).get(v => {
        assert.isTrue(v);
	done();
      });
    });

    test('onlogout(false)', function(done) {
      MockMozId.onlogout(false);
      MockSettingsHelper(loggedIn).get(v => {
        assert.isFalse(v);
	done();
      });
    });

  });
});
