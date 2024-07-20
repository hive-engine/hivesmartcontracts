/* eslint-disable no-await-in-loop */
/* eslint-disable no-template-curly-in-string */
/* eslint-disable valid-typeof */
/* eslint-disable max-len */
/* eslint-disable no-continue */
/* global actions, api */

const UTILITY_TOKEN_SYMBOL = 'BEE';
const UTILITY_TOKEN_PRECISION = 8;

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
};

actions.convert = async (payload) => {
  const {
    quantity, isSignedWithActiveKey,
  } = payload;

  if (api.assert(isSignedWithActiveKey === true, 'you must use a custom_json signed with your active key')
    && api.assert(quantity && typeof quantity === 'string' && !api.BigNumber(quantity).isNaN(), 'invalid params')) {
    const params = await api.db.findOne('params', {});
    if (api.assert(api.BigNumber(quantity).gte(params.minConvertibleAmount), `amount to convert must be >= ${params.minConvertibleAmount}`)
      && api.assert(countDecimals(quantity) <= UTILITY_TOKEN_PRECISION, 'symbol precision mismatch')) {
      // burn the tokens to be converted
      const hasEnoughBalance = await verifyUtilityTokenBalance(quantity, api.sender);
      if (!api.assert(hasEnoughBalance, 'not enough balance')) {
        return false;
      }
      if (!(await burnUtilityTokens(quantity, isSignedWithActiveKey))) {
        return false;
      }

      const feePercentage = api.BigNumber(params.feePercentage);
      api.debug('this is a test');

      return true;
    }
  }

  return false;
};
