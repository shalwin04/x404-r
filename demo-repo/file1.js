// file1.js - User Service (Callback-based)
// This file demonstrates callback-based async code that needs refactoring

const fs = require('fs');
const path = require('path');

/**
 * Get user by ID from the database
 * @param {string} userId - The user ID
 * @param {Function} callback - Callback function (err, user)
 */
function getUser(userId, callback) {
  // Simulate database query
  setTimeout(function() {
    if (!userId) {
      callback(new Error('User ID is required'), null);
      return;
    }

    const users = {
      '1': { id: '1', name: 'Alice', email: 'alice@example.com' },
      '2': { id: '2', name: 'Bob', email: 'bob@example.com' },
      '3': { id: '3', name: 'Charlie', email: 'charlie@example.com' }
    };

    const user = users[userId];
    if (!user) {
      callback(new Error('User not found'), null);
      return;
    }

    callback(null, user);
  }, 100);
}

/**
 * Get user's orders
 * @param {string} userId - The user ID
 * @param {Function} callback - Callback function (err, orders)
 */
function getUserOrders(userId, callback) {
  // Simulate API call
  setTimeout(function() {
    if (!userId) {
      callback(new Error('User ID is required'), null);
      return;
    }

    const orders = [
      { id: 'ord1', userId: userId, product: 'Laptop', amount: 999 },
      { id: 'ord2', userId: userId, product: 'Mouse', amount: 29 }
    ];

    callback(null, orders);
  }, 150);
}

/**
 * Calculate total spending for a user
 * @param {string} userId - The user ID
 * @param {Function} callback - Callback function (err, result)
 */
function calculateUserSpending(userId, callback) {
  getUser(userId, function(err, user) {
    if (err) {
      callback(err, null);
      return;
    }

    getUserOrders(userId, function(err, orders) {
      if (err) {
        callback(err, null);
        return;
      }

      const total = orders.reduce(function(sum, order) {
        return sum + order.amount;
      }, 0);

      callback(null, {
        user: user,
        orders: orders,
        totalSpending: total
      });
    });
  });
}

/**
 * Save user data to file
 * @param {Object} userData - User data to save
 * @param {Function} callback - Callback function (err)
 */
function saveUserData(userData, callback) {
  const filePath = path.join(__dirname, 'data', 'users.json');

  fs.mkdir(path.dirname(filePath), { recursive: true }, function(err) {
    if (err) {
      callback(err);
      return;
    }

    fs.writeFile(filePath, JSON.stringify(userData, null, 2), function(err) {
      if (err) {
        callback(err);
        return;
      }
      callback(null);
    });
  });
}

/**
 * Load user data from file
 * @param {Function} callback - Callback function (err, data)
 */
function loadUserData(callback) {
  const filePath = path.join(__dirname, 'data', 'users.json');

  fs.readFile(filePath, 'utf8', function(err, data) {
    if (err) {
      if (err.code === 'ENOENT') {
        callback(null, []);
        return;
      }
      callback(err, null);
      return;
    }

    try {
      const parsed = JSON.parse(data);
      callback(null, parsed);
    } catch (parseErr) {
      callback(parseErr, null);
    }
  });
}

module.exports = {
  getUser,
  getUserOrders,
  calculateUserSpending,
  saveUserData,
  loadUserData
};
