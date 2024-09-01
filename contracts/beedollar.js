/* eslint-disable no-await-in-loop */
/* eslint-disable no-template-curly-in-string */
/* eslint-disable valid-typeof */
/* eslint-disable max-len */
/* eslint-disable no-continue */
/* global actions, api */

const UTILITY_TOKEN_SYMBOL = 'BEE';
const UTILITY_TOKEN_PRECISION = 8;
const BEED_PRECISION = 4;

actions.updateParams = async (payload) => {
  if (api.sender !== api.owner) return;

  const {
    minConvertibleAmount,
    feePercentage,
  } = payload;

  const params = await api.db.findOne('params', {});

  if (minConvertibleAmount && typeof minConvertibleAmount === 'string' && !api.BigNumber(minConvertibleAmount).isNaN() && api.BigNumber(minConvertibleAmount).gte(0)) {
    params.minConvertibleAmount = minConvertibleAmount;
  }
  if (feePercentage && typeof feePercentage === 'string' && !api.BigNumber(feePercentage).isNaN() && api.BigNumber(feePercentage).gte(0)) {
    params.feePercentage = feePercentage;
  }

  await api.db.update('params', params);
};

// ----- START UTILITY FUNCTIONS -----

const countDecimals = value => api.BigNumber(value).dp();

// check that token transfers succeeded
const isTokenTransferVerified = (result, from, to, symbol, quantity, eventStr) => {
  if (result.errors === undefined
    && result.events && result.events.find(el => el.contract === 'tokens' && el.event === eventStr
      && el.data.from === from && el.data.to === to && el.data.quantity === quantity && el.data.symbol === symbol) !== undefined) {
    return true;
  }
  return false;
};

const verifyUtilityTokenBalance = async (amount, account) => {
  if (api.BigNumber(amount).lte(0)) {
    return true;
  }
  const utilityTokenBalance = await api.db.findOneInTable('tokens', 'balances', { account, symbol: UTILITY_TOKEN_SYMBOL });
  if (utilityTokenBalance && api.BigNumber(utilityTokenBalance.balance).gte(amount)) {
    return true;
  }
  return false;
};

const burnUtilityTokens = async (amount, isSignedWithActiveKey) => {
  if (api.BigNumber(amount).gt(0)) {
    const res = await api.executeSmartContract('tokens', 'transfer', {
      to: 'null', symbol: UTILITY_TOKEN_SYMBOL, quantity: amount, isSignedWithActiveKey,
    });
    // check if the tokens were sent
    if (!isTokenTransferVerified(res, api.sender, 'null', UTILITY_TOKEN_SYMBOL, amount, 'transfer')) {
      return false;
    }
  }
  return true;
};

// ----- END UTILITY FUNCTIONS -----

actions.createSSC = async () => {
  const tableExists = await api.db.tableExists('params');
  if (tableExists === false) {
    await api.db.createTable('params');

    const params = {};
    params.minConvertibleAmount = '1';
    params.feePercentage = '0.01';
    await api.db.insert('params', params);
  }
  const token = await api.db.findOneInTable('tokens', 'tokens', { symbol: 'BEED' });
  if (!token) {
    // bootstrap the BEED token into existence
    const tokenProps = {
      name: 'BeeD',
      symbol: 'BEED',
      url: 'https://tribaldex.com',
      precision: BEED_PRECISION,
      maxSupply: `${Number.MAX_SAFE_INTEGER}`,
    };

    const meta = {
      url: 'https://tribaldex.com',
      icon: 'https://cdn.tribaldex.com/tribaldex/token-icons/BEE.png',
      desc: 'BEED is the native stablecoin for the Hive Engine platform. You can mint new BEED by burning BEE.',
    };

    const updateData = {
      symbol: 'BEED',
      metadata: meta,
    };

    await api.executeSmartContract('tokens', 'create', tokenProps);
    await api.executeSmartContract('tokens', 'updateMetadata', updateData);
  }
};

actions.convert = async (payload) => {
  const {
    quantity, isSignedWithActiveKey,
  } = payload;

  if (api.assert(isSignedWithActiveKey === true, 'you must use a custom_json signed with your active key')
    && api.assert(quantity && typeof quantity === 'string' && !api.BigNumber(quantity).isNaN(), 'invalid params')) {
    const params = await api.db.findOne('params', {});
    const qtyAsBigNum = api.BigNumber(quantity);
    if (api.assert(qtyAsBigNum.gte(params.minConvertibleAmount), `amount to convert must be >= ${params.minConvertibleAmount}`)
      && api.assert(countDecimals(quantity) <= UTILITY_TOKEN_PRECISION, 'symbol precision mismatch')) {
      const hasEnoughBalance = await verifyUtilityTokenBalance(quantity, api.sender);
      if (!api.assert(hasEnoughBalance, 'not enough balance')) {
        return false;
      }

      // subtract the conversion fee from the amount to be converted
      const feePercentage = api.BigNumber(params.feePercentage);
      let fee = '0';
      let finalQty = qtyAsBigNum;
      if (feePercentage.gt(0)) {
        fee = qtyAsBigNum.multipliedBy(feePercentage).toFixed(UTILITY_TOKEN_PRECISION, api.BigNumber.ROUND_UP);

        if (api.BigNumber(fee).lt('0.00000001')) {
          fee = '0.00000001';
        }

        finalQty = qtyAsBigNum.minus(fee);
      }

      // calculate BEE price in dollars based on high liquidity Diesel Pools
      // need to do it this way as we can't access external price oracles from the smart contracts system
      const beePool = await api.db.findOneInTable('marketpools', 'pools', { tokenPair: 'SWAP.HIVE:BEE' });
      const hbdPool = await api.db.findOneInTable('marketpools', 'pools', { tokenPair: 'SWAP.HIVE:SWAP.HBD' });
      const beePriceInHive = (beePool && beePool.quotePrice) ? beePool.quotePrice : '0';
      const hivePriceInHBD = (hbdPool && hbdPool.basePrice) ? hbdPool.basePrice : '0';
      const beePriceInDollars = api.BigNumber(beePriceInHive).multipliedBy(hivePriceInHBD).toFixed(UTILITY_TOKEN_PRECISION, api.BigNumber.ROUND_DOWN);

      // calculate how much BEED should be issued
      const beedToIssue = finalQty.multipliedBy(beePriceInDollars).toFixed(BEED_PRECISION, api.BigNumber.ROUND_DOWN);
      if (!api.assert(api.BigNumber(beedToIssue).gte('0.0001'), `resulting token issuance is too small; BEE price is ${beePriceInDollars}`)) {
        return false;
      }

      // burn the tokens to be converted
      if (!(await burnUtilityTokens(quantity, isSignedWithActiveKey))) {
        return false;
      }

      // finally, issue the new BEED
      await api.executeSmartContract('tokens', 'issue', {
        to: api.sender, symbol: 'BEED', quantity: beedToIssue,
      });

      api.emit('beeConversion', {
        to: api.sender, fee, bee: finalQty.toFixed(UTILITY_TOKEN_PRECISION), beed: beedToIssue, beePriceInUSD: beePriceInDollars,
      });

      return true;
    }
  }

  return false;
};
