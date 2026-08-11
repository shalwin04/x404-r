// file3.js - Notification Service (Callback-based)
// This file demonstrates event-driven callbacks that need refactoring

const EventEmitter = require('events');

/**
 * Send email notification
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} body - Email body
 * @param {Function} callback - Callback function (err, result)
 */
function sendEmail(to, subject, body, callback) {
  // Simulate email sending
  setTimeout(function() {
    if (!to || !to.includes('@')) {
      callback(new Error('Invalid email address'), null);
      return;
    }

    if (!subject || subject.length === 0) {
      callback(new Error('Subject is required'), null);
      return;
    }

    const result = {
      messageId: 'msg-' + Date.now(),
      to: to,
      subject: subject,
      sentAt: new Date().toISOString(),
      status: 'sent'
    };

    callback(null, result);
  }, 200);
}

/**
 * Send SMS notification
 * @param {string} phoneNumber - Recipient phone number
 * @param {string} message - SMS message
 * @param {Function} callback - Callback function (err, result)
 */
function sendSMS(phoneNumber, message, callback) {
  // Simulate SMS sending
  setTimeout(function() {
    if (!phoneNumber || phoneNumber.length < 10) {
      callback(new Error('Invalid phone number'), null);
      return;
    }

    if (!message || message.length > 160) {
      callback(new Error('Message must be 1-160 characters'), null);
      return;
    }

    const result = {
      smsId: 'sms-' + Date.now(),
      to: phoneNumber,
      message: message,
      sentAt: new Date().toISOString(),
      status: 'delivered'
    };

    callback(null, result);
  }, 150);
}

/**
 * Send push notification
 * @param {string} deviceToken - Device token
 * @param {Object} payload - Notification payload
 * @param {Function} callback - Callback function (err, result)
 */
function sendPushNotification(deviceToken, payload, callback) {
  // Simulate push notification
  setTimeout(function() {
    if (!deviceToken) {
      callback(new Error('Device token is required'), null);
      return;
    }

    if (!payload || !payload.title) {
      callback(new Error('Notification title is required'), null);
      return;
    }

    const result = {
      notificationId: 'push-' + Date.now(),
      deviceToken: deviceToken,
      payload: payload,
      sentAt: new Date().toISOString(),
      status: 'sent'
    };

    callback(null, result);
  }, 100);
}

/**
 * Send notification through all channels
 * @param {Object} user - User object with contact info
 * @param {Object} notification - Notification content
 * @param {Function} callback - Callback function (err, results)
 */
function sendAllNotifications(user, notification, callback) {
  const results = {
    email: null,
    sms: null,
    push: null,
    errors: []
  };

  let completed = 0;
  const totalChannels = 3;

  function checkComplete() {
    completed++;
    if (completed === totalChannels) {
      if (results.errors.length === totalChannels) {
        callback(new Error('All notification channels failed'), null);
      } else {
        callback(null, results);
      }
    }
  }

  // Send email
  if (user.email) {
    sendEmail(user.email, notification.subject, notification.body, function(err, result) {
      if (err) {
        results.errors.push({ channel: 'email', error: err.message });
      } else {
        results.email = result;
      }
      checkComplete();
    });
  } else {
    results.errors.push({ channel: 'email', error: 'No email address' });
    checkComplete();
  }

  // Send SMS
  if (user.phone) {
    sendSMS(user.phone, notification.shortMessage || notification.subject, function(err, result) {
      if (err) {
        results.errors.push({ channel: 'sms', error: err.message });
      } else {
        results.sms = result;
      }
      checkComplete();
    });
  } else {
    results.errors.push({ channel: 'sms', error: 'No phone number' });
    checkComplete();
  }

  // Send push notification
  if (user.deviceToken) {
    sendPushNotification(user.deviceToken, {
      title: notification.subject,
      body: notification.shortMessage || notification.body
    }, function(err, result) {
      if (err) {
        results.errors.push({ channel: 'push', error: err.message });
      } else {
        results.push = result;
      }
      checkComplete();
    });
  } else {
    results.errors.push({ channel: 'push', error: 'No device token' });
    checkComplete();
  }
}

/**
 * Log notification to database
 * @param {Object} notification - Notification details
 * @param {Function} callback - Callback function (err)
 */
function logNotification(notification, callback) {
  // Simulate database write
  setTimeout(function() {
    console.log('Notification logged:', notification.type, notification.id);
    callback(null);
  }, 50);
}

/**
 * Send notification with logging
 * @param {string} type - Notification type
 * @param {Object} recipient - Recipient info
 * @param {Object} content - Notification content
 * @param {Function} callback - Callback function (err, result)
 */
function sendWithLogging(type, recipient, content, callback) {
  let sendFn;
  let params;

  switch (type) {
    case 'email':
      sendFn = sendEmail;
      params = [recipient.email, content.subject, content.body];
      break;
    case 'sms':
      sendFn = sendSMS;
      params = [recipient.phone, content.message];
      break;
    case 'push':
      sendFn = sendPushNotification;
      params = [recipient.deviceToken, content];
      break;
    default:
      callback(new Error('Unknown notification type'), null);
      return;
  }

  params.push(function(err, result) {
    if (err) {
      logNotification({ type: type, status: 'failed', error: err.message }, function() {
        callback(err, null);
      });
      return;
    }

    logNotification({ type: type, id: result.messageId || result.smsId || result.notificationId, status: 'success' }, function(logErr) {
      if (logErr) {
        console.error('Failed to log notification:', logErr);
      }
      callback(null, result);
    });
  });

  sendFn.apply(null, params);
}

/**
 * Retry notification with exponential backoff
 * @param {Function} sendFn - Send function to retry
 * @param {Array} params - Parameters for send function
 * @param {number} maxRetries - Maximum retry attempts
 * @param {Function} callback - Callback function (err, result)
 */
function retryWithBackoff(sendFn, params, maxRetries, callback) {
  let attempts = 0;

  function attempt() {
    const callParams = params.concat([function(err, result) {
      if (err) {
        attempts++;
        if (attempts < maxRetries) {
          const delay = Math.pow(2, attempts) * 100;
          console.log('Retry attempt', attempts, 'in', delay, 'ms');
          setTimeout(attempt, delay);
        } else {
          callback(new Error('Max retries exceeded: ' + err.message), null);
        }
      } else {
        callback(null, result);
      }
    }]);

    sendFn.apply(null, callParams);
  }

  attempt();
}

module.exports = {
  sendEmail,
  sendSMS,
  sendPushNotification,
  sendAllNotifications,
  sendWithLogging,
  retryWithBackoff
};
