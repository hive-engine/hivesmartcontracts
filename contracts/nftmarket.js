/* eslint-disable no-await-in-loop */
/* eslint-disable max-len */
/* global actions, api */

const CONTRACT_NAME = 'nftmarket';

// eslint-disable-next-line no-template-curly-in-string
const UTILITY_TOKEN_SYMBOL = "'${CONSTANTS.UTILITY_TOKEN_SYMBOL}$'";

// cannot buy or sell more than this number of NFT instances in one action
const MAX_NUM_UNITS_OPERABLE = 50;

actions.createSSC = async () => {
  const tableExists = await api.db.tableExists('sellBook');

  if (tableExists === false) {
    await api.db.createTable('tradesHistory', ['symbol']);
    await api.db.createTable('metrics', ['symbol']);
  }
};

// check that token transfers succeeded
const isTokenTransferVerified = (result, from, to, symbol, quantity, eventStr) => {
  if (result.errors === undefined
    && result.events && result.events.find(el => el.contract === 'tokens' && el.event === eventStr
    && el.data.from === from && el.data.to === to && el.data.quantity === quantity && el.data.symbol === symbol) !== undefined) {
    return true;
  }
  return false;
};

const countDecimals = value => api.BigNumber(value).dp();

// a valid Steem account is between 3 and 16 characters in length
const isValidSteemAccountLength = account => account.length >= 3 && account.length <= 16;

// helper for buy action
const makeMapKey = (account, type) => account + '-' + type;

const isValidIdArray = (arr) => {
  try {
    if (!api.assert(arr && typeof arr === 'object' && Array.isArray(arr), 'invalid id list')) {
      return false;
    }

    if (!api.assert(arr.length <= MAX_NUM_UNITS_OPERABLE, `cannot act on more than ${MAX_NUM_UNITS_OPERABLE} IDs at once`)) {
      return false;
    }

    for (let i = 0; i < arr.length; i += 1) {
      const id = arr[i];
      if (!api.assert(id && typeof id === 'string' && !api.BigNumber(id).isNaN() && api.BigNumber(id).gt(0), 'invalid id list')) {
        return false;
      }
    }
  } catch (e) {
    return false;
  }
  return true;
};

actions.enableMarket = async (payload) => {
  const {
    symbol,
    isSignedWithActiveKey,
  } = payload;

  if (api.assert(isSignedWithActiveKey === true, 'you must use a custom_json signed with your active key')
    && api.assert(symbol && typeof symbol === 'string', 'invalid params')) {
    // make sure NFT exists and verify ownership
    const nft = await api.db.findOneInTable('nft', 'nfts', { symbol });
    if (api.assert(nft !== null, 'symbol does not exist')
      && api.assert(nft.issuer === api.sender, 'must be the issuer')) {
      // create a new table to hold market orders for this NFT
      // eslint-disable-next-line prefer-template
      const marketTableName = symbol + 'sellBook';
      const metricsTableName = symbol + 'metrics';
      const tableExists = await api.db.tableExists(marketTableName);
      if (api.assert(tableExists === false, 'market already enabled')) {
        await api.db.createTable(marketTableName, ['account', 'ownedBy', 'nftId', 'grouping', 'priceSymbol']);
        await api.db.createTable(metricsTableName, ['grouping']);

        api.emit('enableMarket', { symbol });
      }
    }
  }
};

actions.changePrice = async (payload) => {
  const {
    symbol,
    nfts,
    price,
    isSignedWithActiveKey,
  } = payload;

  if (!api.assert(symbol && typeof symbol === 'string', 'invalid params')) {
    return;
  }

  const marketTableName = symbol + 'sellBook';
  const tableExists = await api.db.tableExists(marketTableName);

  if (api.assert(isSignedWithActiveKey === true, 'you must use a custom_json signed with your active key')
    && isValidIdArray(nfts)
    && api.assert(price && typeof price === 'string' && !api.BigNumber(price).isNaN(), 'invalid params')
    && api.assert(tableExists, 'market not enabled for symbol')) {
    // look up order info
    const orders = await api.db.find(
      marketTableName,
      {
        nftId: {
          $in: nfts,
        },
      },
      MAX_NUM_UNITS_OPERABLE,
      0,
      [{ index: 'nftId', descending: false }],
    );

    if (orders.length > 0) {
      // need to make sure that caller is actually the owner of each order
      // and all orders have the same price symbol
      let priceSymbol = '';
      for (let i = 0; i < orders.length; i += 1) {
        const order = orders[i];
        if (priceSymbol === '') {
          priceSymbol = order.priceSymbol;
        }
        if (!api.assert(order.account === api.sender
          && order.ownedBy === 'u', 'all orders must be your own')
          || !api.assert(priceSymbol === order.priceSymbol, 'all orders must have the same price symbol')) {
          return;
        }
      }
      // get the price token params
      const token = await api.db.findOneInTable('tokens', 'tokens', { symbol: priceSymbol });
      if (api.assert(token
        && api.BigNumber(price).gt(0)
        && countDecimals(price) <= token.precision, 'invalid price')) {
        const finalPrice = api.BigNumber(price).toFixed(token.precision);
        for (i = 0; i < orders.length; i += 1) {
          const order = orders[i];
          const oldPrice = order.price;
          order.price = finalPrice;
          order.priceDec = { $numberDecimal: finalPrice };

          await api.db.update(marketTableName, order);

          api.emit('changePrice', {
            symbol,
            nftId: order.nftId,
            oldPrice,
            newPrice: order.price,
            priceSymbol: order.priceSymbol,
            orderId: order._id,
          });
        }
      }
    }
  }
};

actions.cancel = async (payload) => {
  const {
    symbol,
    nfts,
    isSignedWithActiveKey,
  } = payload;

  if (!api.assert(symbol && typeof symbol === 'string', 'invalid params')) {
    return;
  }

  const marketTableName = symbol + 'sellBook';
  const tableExists = await api.db.tableExists(marketTableName);

  if (api.assert(isSignedWithActiveKey === true, 'you must use a custom_json signed with your active key')
    && isValidIdArray(nfts)
    && api.assert(tableExists, 'market not enabled for symbol')) {
    // look up order info
    const orders = await api.db.find(
      marketTableName,
      {
        nftId: {
          $in: nfts,
        },
      },
      MAX_NUM_UNITS_OPERABLE,
      0,
      [{ index: 'nftId', descending: false }],
    );

    if (orders.length > 0) {
      // need to make sure that caller is actually the owner of each order
      const ids = [];
      const idMap = {};
      for (let i = 0; i < orders.length; i += 1) {
        const order = orders[i];
        if (!api.assert(order.account === api.sender
          && order.ownedBy === 'u', 'all orders must be your own')) {
          return;
        }
        ids.push(order.nftId);
        idMap[order.nftId] = order;
      }

      // move the locked NFTs back to their owner
      const nftArray = [];
      const wrappedNfts = {
        symbol,
        ids,
      };
      nftArray.push(wrappedNfts);
      const res = await api.executeSmartContract('nft', 'transfer', {
        fromType: 'contract',
        to: api.sender,
        toType: 'user',
        nfts: nftArray,
        isSignedWithActiveKey,
      });

      // it's possible (but unlikely) that some transfers could have failed
      // due to validation errors & whatnot, so we need to loop over the
      // transfer results and only cancel orders for the transfers that succeeded
      if (res.events) {
        for (let j = 0; j < res.events.length; j += 1) {
          const ev = res.events[j];
          if (ev.contract && ev.event && ev.data
            && ev.contract === 'nft'
            && ev.event === 'transfer'
            && ev.data.from === CONTRACT_NAME
            && ev.data.fromType === 'c'
            && ev.data.to === api.sender
            && ev.data.toType === 'u'
            && ev.data.symbol === symbol) {
            // transfer is verified, now we can cancel the order
            const instanceId = ev.data.id;
            if (instanceId in idMap) {
              const order = idMap[instanceId];

              await api.db.remove(marketTableName, order);

              api.emit('cancelOrder', {
                account: order.account,
                ownedBy: order.ownedBy,
                symbol,
                nftId: order.nftId,
                timestamp: order.timestamp,
                price: order.price,
                priceSymbol: order.priceSymbol,
                fee: order.fee,
                orderId: order._id,
              });
            }
          }
        }
      }
    }
  }
};

actions.buy = async (payload) => {
  const {
    symbol,
    nfts,
    marketAccount,
    isSignedWithActiveKey,
  } = payload;

  if (!api.assert(symbol && typeof symbol === 'string'
    && marketAccount && typeof marketAccount === 'string', 'invalid params')) {
    return;
  }

  const marketTableName = symbol + 'sellBook';
  const tableExists = await api.db.tableExists(marketTableName);

  if (api.assert(isSignedWithActiveKey === true, 'you must use a custom_json signed with your active key')
    && isValidIdArray(nfts)
    && api.assert(tableExists, 'market not enabled for symbol')) {
    const finalMarketAccount = marketAccount.trim().toLowerCase();
    if (api.assert(isValidSteemAccountLength(finalMarketAccount), 'invalid market account')) {
      // look up order info
      const orders = await api.db.find(
        marketTableName,
        {
          nftId: {
            $in: nfts,
          },
        },
        MAX_NUM_UNITS_OPERABLE,
        0,
        [{ index: 'nftId', descending: false }],
      );

      if (orders.length > 0) {
        // do a couple more sanity checks
        let priceSymbol = '';
        for (let i = 0; i < orders.length; i += 1) {
          const order = orders[i];
          if (priceSymbol === '') {
            priceSymbol = order.priceSymbol;
          }
          if (!api.assert(!(order.ownedBy === 'u' && order.account === api.sender), 'cannot fill your own orders')
            || !api.assert(priceSymbol === order.priceSymbol, 'all orders must have the same price symbol')) {
            return;
          }
        }
        // get the price token params
        const token = await api.db.findOneInTable('tokens', 'tokens', { symbol: priceSymbol });
        if (!token) {
          return;
        }

        // create order maps
        let feeTotal = api.BigNumber(0);
        let paymentTotal = api.BigNumber(0);
        let soldNfts = [];
        let sellers = [];
        const sellerMap = {};
        for (i = 0; i < orders.length; i += 1) {
          const order = orders[i];
          const finalPrice = api.BigNumber(order.price);
          const feePercent = order.fee / 10000;
          let finalFee = finalPrice.multipliedBy(feePercent).decimalPlaces(token.precision)
          if (finalFee.gt(finalPrice)) {
            finalFee = finalPrice; // unlikely but need to be sure
          }
          let finalPayment = finalPrice.minus(finalFee).decimalPlaces(token.precision);
          if (finalPayment.lt(0)) {
            finalPayment = api.BigNumber(0); // unlikely but need to be sure
          }
          paymentTotal = paymentTotal.plus(finalPayment);
          feeTotal = feeTotal.plus(finalFee);

          const key = makeMapKey(order.account, order.ownedBy);
          const sellerInfo = key in sellerMap
            ? sellerMap[key]
            : {
              account: order.account,
              ownedBy: order.ownedBy,
              nftIds: [],
              paymentTotal: api.BigNumber(0),
            };

          sellerInfo.paymentTotal = sellerInfo.paymentTotal.plus(finalPayment);
          sellerInfo.nftIds.push(order.nftId);
          sellerMap[key] = sellerInfo;
        }

        // verify buyer has enough funds for payment
        const requiredBalance = paymentTotal.plus(feeTotal).toFixed(token.precision);
        const buyerBalance = await api.db.findOneInTable('tokens', 'balances', { account: api.sender, symbol: priceSymbol });
        if (!api.assert(buyerBalance
          && api.BigNumber(buyerBalance.balance).gte(requiredBalance), 'you must have enough tokens for payment')) {
          return;
        }
        paymentTotal = paymentTotal.toFixed(token.precision);

        // send fees to market account
        if (feeTotal.gt(0)) {
          feeTotal = feeTotal.toFixed(token.precision);
          let res = await api.executeSmartContract('tokens', 'transfer', {
            to: finalMarketAccount, symbol: priceSymbol, quantity: feeTotal, isSignedWithActiveKey,
          });
          if (!api.assert(isTokenTransferVerified(res, api.sender, finalMarketAccount, priceSymbol, feeTotal, 'transfer'), 'unable to transfer market fees')) {
            return;
          }
        }

        // send payments to sellers
        // eslint-disable-next-line no-restricted-syntax
        for (const info of Object.values(sellerMap)) {
          if (info.paymentTotal.gt(0)) {
            const contractAction = info.ownedBy === 'u' ? 'transfer' : 'transferToContract';
            info.paymentTotal = info.paymentTotal.toFixed(token.precision);
            let res = await api.executeSmartContract('tokens', contractAction, {
              to: info.account, symbol: priceSymbol, quantity: info.paymentTotal, isSignedWithActiveKey,
            });
            if (api.assert(isTokenTransferVerified(res, api.sender, info.account, priceSymbol, info.paymentTotal, contractAction), `unable to transfer payment to ${info.account}`)) {
              soldNfts = soldNfts.concat(info.nftIds);
              sellers.push(info);
            }
          } else {
            soldNfts = soldNfts.concat(info.nftIds);
            sellers.push(info);
          }
        }

        // transfer sold NFT instances to new owner
        const nftArray = [];
        const wrappedNfts = {
          symbol,
          ids: soldNfts,
        };
        nftArray.push(wrappedNfts);
        await api.executeSmartContract('nft', 'transfer', {
          fromType: 'contract',
          to: api.sender,
          toType: 'user',
          nfts: nftArray,
          isSignedWithActiveKey,
        });

        // delete sold market orders
        const soldSet = new Set(soldNfts);
        for (i = 0; i < orders.length; i += 1) {
          const order = orders[i];
          if (soldSet.has(order.nftId)) {
            await api.db.remove(marketTableName, order);
          }
        }

        api.emit('hitSellOrder', {
          symbol,
          priceSymbol,
          sellers,
          paymentTotal,
          feeTotal,
        });
      }
    }
  }
};

actions.sell = async (payload) => {
  const {
    symbol,
    nfts,
    price,
    priceSymbol,
    fee,
    isSignedWithActiveKey,
  } = payload;

  if (!api.assert(symbol && typeof symbol === 'string', 'invalid params')) {
    return;
  }

  const marketTableName = symbol + 'sellBook';
  const instanceTableName = symbol + 'instances';
  const tableExists = await api.db.tableExists(marketTableName);

  if (api.assert(isSignedWithActiveKey === true, 'you must use a custom_json signed with your active key')
    && api.assert(nfts && typeof nfts === 'object' && Array.isArray(nfts)
    && priceSymbol && typeof priceSymbol === 'string'
    && price && typeof price === 'string' && !api.BigNumber(price).isNaN()
    && fee && typeof fee === 'number' && fee >= 0 && fee <= 10000 && Number.isInteger(fee), 'invalid params')
    && api.assert(nfts.length <= MAX_NUM_UNITS_OPERABLE, `cannot sell more than ${MAX_NUM_UNITS_OPERABLE} NFT instances at once`)
    && api.assert(tableExists, 'market not enabled for symbol')) {
    const nft = await api.db.findOneInTable('nft', 'nfts', { symbol });
    if (!api.assert(nft && nft.groupBy && nft.groupBy.length > 0, 'market grouping not set')) {
      return;
    }

    // get the price token params
    const token = await api.db.findOneInTable('tokens', 'tokens', { symbol: priceSymbol });
    if (api.assert(token
      && api.BigNumber(price).gt(0)
      && countDecimals(price) <= token.precision, 'invalid price')) {
      // lock the NFTs to sell by moving them to this contract for safekeeping
      const nftArray = [];
      const wrappedNfts = {
        symbol,
        ids: nfts,
      };
      nftArray.push(wrappedNfts);
      const res = await api.executeSmartContract('nft', 'transfer', {
        fromType: 'user',
        to: CONTRACT_NAME,
        toType: 'contract',
        nfts: nftArray,
        isSignedWithActiveKey,
      });

      // it's possible that some transfers could have failed due to validation
      // errors & whatnot, so we need to loop over the transfer results and
      // only create market orders for the transfers that succeeded
      if (res.events) {
        const blockDate = new Date(`${api.steemBlockTimestamp}.000Z`);
        const timestamp = blockDate.getTime();
        const finalPrice = api.BigNumber(price).toFixed(token.precision);
        const nftIntegerIdList = [];
        const orderDataMap = {};

        for (let i = 0; i < res.events.length; i += 1) {
          const ev = res.events[i];
          if (ev.contract && ev.event && ev.data
            && ev.contract === 'nft'
            && ev.event === 'transfer'
            && ev.data.from === api.sender
            && ev.data.fromType === 'u'
            && ev.data.to === CONTRACT_NAME
            && ev.data.toType === 'c'
            && ev.data.symbol === symbol) {
            // transfer is verified, now we can add a market order
            let instanceId = ev.data.id;

            const orderData = {
              nftId: instanceId,
              grouping: {},
            };
            const integerId = api.BigNumber(instanceId).toNumber();
            nftIntegerIdList.push(integerId);
            orderDataMap[integerId] = orderData;
          }
        }

        // query NFT instances to construct the grouping
        const instances = await api.db.findInTable(
          'nft',
          instanceTableName,
          {
            _id: {
              $in: nftIntegerIdList,
            },
          },
          MAX_NUM_UNITS_OPERABLE,
          0,
          [{ index: '_id', descending: false }],
        );

        for (let j = 0; j < instances.length; j += 1) {
          const instance = instances[j];
          const grouping = {};
          nft.groupBy.forEach((name) => {
            if (instance.properties[name] !== undefined && instance.properties[name] !== null) {
              grouping[name] = instance.properties[name].toString();
            } else {
              grouping[name] = '';
            }
          });
          orderDataMap[instance._id].grouping = grouping;
        }

        // create the orders
        for (let k = 0; k < nftIntegerIdList.length; k += 1) {
          const intId = nftIntegerIdList[k];
          const orderInfo = orderDataMap[intId];
          const order = {
            account: api.sender,
            ownedBy: 'u',
            nftId: orderInfo.nftId,
            grouping: orderInfo.grouping,
            timestamp,
            price: finalPrice,
            priceDec: { $numberDecimal: finalPrice },
            priceSymbol,
            fee,
          };

          const result = await api.db.insert(marketTableName, order);

          api.emit('sellOrder', {
            account: order.account,
            ownedBy: order.ownedBy,
            symbol,
            nftId: order.nftId,
            timestamp,
            price: order.price,
            priceSymbol: order.priceSymbol,
            fee,
            orderId: result._id,
          });
        }
      }
    }
  }
};
