// file2.js - Product Service (Callback-based)
// This file demonstrates nested callbacks (callback hell) that needs refactoring

const https = require('https');

/**
 * Fetch product from API
 * @param {string} productId - The product ID
 * @param {Function} callback - Callback function (err, product)
 */
function fetchProduct(productId, callback) {
  // Simulate API call
  setTimeout(function() {
    if (!productId) {
      callback(new Error('Product ID is required'), null);
      return;
    }

    const products = {
      'p1': { id: 'p1', name: 'Laptop', price: 999, stock: 50 },
      'p2': { id: 'p2', name: 'Mouse', price: 29, stock: 200 },
      'p3': { id: 'p3', name: 'Keyboard', price: 79, stock: 100 }
    };

    const product = products[productId];
    if (!product) {
      callback(new Error('Product not found'), null);
      return;
    }

    callback(null, product);
  }, 100);
}

/**
 * Check inventory for product
 * @param {string} productId - The product ID
 * @param {number} quantity - Requested quantity
 * @param {Function} callback - Callback function (err, available)
 */
function checkInventory(productId, quantity, callback) {
  fetchProduct(productId, function(err, product) {
    if (err) {
      callback(err, null);
      return;
    }

    const available = product.stock >= quantity;
    callback(null, {
      productId: productId,
      requested: quantity,
      available: available,
      currentStock: product.stock
    });
  });
}

/**
 * Apply discount to product
 * @param {string} productId - The product ID
 * @param {string} discountCode - Discount code
 * @param {Function} callback - Callback function (err, result)
 */
function applyDiscount(productId, discountCode, callback) {
  fetchProduct(productId, function(err, product) {
    if (err) {
      callback(err, null);
      return;
    }

    // Simulate discount validation
    setTimeout(function() {
      const discounts = {
        'SAVE10': 0.10,
        'SAVE20': 0.20,
        'HALFOFF': 0.50
      };

      const discountRate = discounts[discountCode];
      if (!discountRate) {
        callback(new Error('Invalid discount code'), null);
        return;
      }

      const discountedPrice = product.price * (1 - discountRate);
      callback(null, {
        product: product,
        originalPrice: product.price,
        discountRate: discountRate,
        finalPrice: discountedPrice
      });
    }, 50);
  });
}

/**
 * Process order with full validation
 * @param {string} productId - The product ID
 * @param {number} quantity - Order quantity
 * @param {string} discountCode - Optional discount code
 * @param {Function} callback - Callback function (err, order)
 */
function processOrder(productId, quantity, discountCode, callback) {
  // Callback hell example
  fetchProduct(productId, function(err, product) {
    if (err) {
      callback(err, null);
      return;
    }

    checkInventory(productId, quantity, function(err, inventory) {
      if (err) {
        callback(err, null);
        return;
      }

      if (!inventory.available) {
        callback(new Error('Insufficient stock'), null);
        return;
      }

      if (discountCode) {
        applyDiscount(productId, discountCode, function(err, discount) {
          if (err) {
            // Continue without discount if invalid
            console.log('Discount error:', err.message);
            finishOrder(product, quantity, product.price, callback);
          } else {
            finishOrder(product, quantity, discount.finalPrice, callback);
          }
        });
      } else {
        finishOrder(product, quantity, product.price, callback);
      }
    });
  });
}

/**
 * Finish order processing
 * @param {Object} product - Product object
 * @param {number} quantity - Order quantity
 * @param {number} unitPrice - Price per unit
 * @param {Function} callback - Callback function (err, order)
 */
function finishOrder(product, quantity, unitPrice, callback) {
  setTimeout(function() {
    const order = {
      orderId: 'ORD-' + Date.now(),
      product: product,
      quantity: quantity,
      unitPrice: unitPrice,
      totalPrice: unitPrice * quantity,
      status: 'confirmed',
      createdAt: new Date().toISOString()
    };

    callback(null, order);
  }, 100);
}

/**
 * Get multiple products with parallel callbacks
 * @param {string[]} productIds - Array of product IDs
 * @param {Function} callback - Callback function (err, products)
 */
function getMultipleProducts(productIds, callback) {
  const results = [];
  let completed = 0;
  let hasError = false;

  if (productIds.length === 0) {
    callback(null, []);
    return;
  }

  productIds.forEach(function(productId, index) {
    fetchProduct(productId, function(err, product) {
      if (hasError) return;

      if (err) {
        hasError = true;
        callback(err, null);
        return;
      }

      results[index] = product;
      completed++;

      if (completed === productIds.length) {
        callback(null, results);
      }
    });
  });
}

module.exports = {
  fetchProduct,
  checkInventory,
  applyDiscount,
  processOrder,
  getMultipleProducts
};
