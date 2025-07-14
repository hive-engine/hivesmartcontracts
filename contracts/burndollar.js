/* eslint-disable no-await-in-loop */
/* eslint-disable no-template-curly-in-string */
/* eslint-disable valid-typeof */
/* eslint-disable max-len */
/* eslint-disable no-continue */
/* global actions, api */

const stablePairArray = ['SWAP.HBD', 'SWAP.USDT', 'SWAP.DAI', 'SWAP.USDC'];

// begin utility functions
const countDecimals = value => api.BigNumber(value).dp();
const verifyTokenCreation = async (symbolFind) => {
  const createD = await api.db.findOneInTable('tokens', 'tokens', { symbol: symbolFind });

  if (!createD) {
    return false;
  }
  return true;
};

const verifyTokenBalance = async (account, amount, symbolFind) => {
  const findTokenBalance = await api.db.findOneInTable('tokens', 'balances', { account, symbol: symbolFind });

  if (findTokenBalance && api.BigNumber(findTokenBalance.balance).gte(amount)) {
    return true;
  }
  return false;
};

const checkStablePosition = (tokenPair) => {
  const [firstToken, secondToken] = tokenPair.split(':');

  if (stablePairArray.includes(firstToken)) {
    return 'base';
  } if (stablePairArray.includes(secondToken)) {
    return 'quote';
  }
  return false;
};

const findMarketPools = async (parentSymbol, toggle) => {
  const childSymbol = `${parentSymbol}.D`;
  let poolData;

  if (toggle === 'stable') {
    const stableParentArray = [`${parentSymbol}`, `${childSymbol}`];
    const stableResults = stableParentArray.flatMap(pElement => stablePairArray.flatMap(sElement => [
      `${sElement}:${pElement}`,
      `${pElement}:${sElement}`,
    ]));

    const multiPoolData = await api.db.findInTable('marketpools', 'pools', {
      tokenPair: { $in: stableResults },
    });

    // in the case token is in multiple pools find the one with the largest quantity of base+quote
    poolData = multiPoolData.length > 0 ? [multiPoolData.reduce((max, item) => {
      const totalQuantity = item.baseQuantity + item.quoteQuantity;
      return totalQuantity > (max.baseQuantity + max.quoteQuantity) ? item : max;
    }, multiPoolData[0])] : [];
  }

  if (toggle === 'market') {
    const marketParentArray = [`${parentSymbol}:${childSymbol}`, `${childSymbol}:${parentSymbol}`];

    poolData = await api.db.findInTable('marketpools', 'pools', {
      tokenPair: { $in: marketParentArray },
    });
  }

  const validPools = poolData.map(pool => ({
    tokenPair: pool.tokenPair,
    basePrice: pool.basePrice || '0',
    quotePrice: pool.quotePrice || '0',
    baseQuantity: pool.baseQuantity || '0',
    quoteQuantity: pool.quoteQuantity || '0',
  }));
  return validPools.length > 0 ? validPools : null;
};

const calcParentPool = async (name, pool, tokenPriceUSD, precision) => {
  const [firstToken, secondToken] = pool.tokenPair.split(':');
  let quoteOrBasePosition;
  let otherTokenPriceUSD;
  let halfPoolinUSD;
  let fullPoolinUSD;
  let parentTokenPrice;
  let returnObject = {};

  if (name.includes(firstToken)) {
    quoteOrBasePosition = 'base';
  } if (name.includes(secondToken)) {
    quoteOrBasePosition = 'quote';
  }

  if (quoteOrBasePosition && quoteOrBasePosition === 'base') {
    otherTokenPriceUSD = api.BigNumber(pool.quotePrice).multipliedBy(tokenPriceUSD).toFixed(precision, api.BigNumber.ROUND_DOWN);
    if (!name.includes('.D')) {
      parentTokenPrice = api.BigNumber(otherTokenPriceUSD).toFixed(precision, api.BigNumber.ROUND_DOWN);
    } else {
      parentTokenPrice = api.BigNumber(tokenPriceUSD).toFixed(precision, api.BigNumber.ROUND_DOWN);
    }
    halfPoolinUSD = api.BigNumber(otherTokenPriceUSD).multipliedBy(pool.baseQuantity).toFixed(precision, api.BigNumber.ROUND_DOWN);
    // Conservative value of the pool: multiply the value of the half pool by 1.95
    fullPoolinUSD = api.BigNumber(halfPoolinUSD).multipliedBy(1.95).toFixed(precision, api.BigNumber.ROUND_DOWN);
    returnObject = {
      quoteToken: firstToken, quotePriceUSD: otherTokenPriceUSD, baseToken: secondToken, basePriceUSD: tokenPriceUSD, precision, poolValueUSD: fullPoolinUSD, parentPrice: parentTokenPrice,
    };
  } else if (quoteOrBasePosition && quoteOrBasePosition === 'quote') { // perform calc based on second position === quote
  // we have the price of one token from the stable pool calc, we need to calc the price of the token's pair
    otherTokenPriceUSD = api.BigNumber(pool.basePrice).multipliedBy(tokenPriceUSD).toFixed(precision, api.BigNumber.ROUND_DOWN);

    if (!name.includes('.D')) {
      parentTokenPrice = api.BigNumber(tokenPriceUSD).toFixed(precision, api.BigNumber.ROUND_DOWN);
    } else {
      parentTokenPrice = api.BigNumber(otherTokenPriceUSD).toFixed(precision, api.BigNumber.ROUND_DOWN);
    }
    halfPoolinUSD = api.BigNumber(otherTokenPriceUSD).multipliedBy(pool.quoteQuantity).toFixed(precision, api.BigNumber.ROUND_DOWN);
    // Conservative value of the pool: multiply the value of the half pool by 1.95
    fullPoolinUSD = api.BigNumber(halfPoolinUSD).multipliedBy(1.95).toFixed(precision, api.BigNumber.ROUND_DOWN);
    returnObject = {
      quoteToken: firstToken, quotePriceUSD: tokenPriceUSD, baseToken: secondToken, basePriceUSD: otherTokenPriceUSD, precision, poolValueUSD: fullPoolinUSD, parentPrice: parentTokenPrice,
    };
  }
  return returnObject;
};

const isTokenTransferVerified = (result, from, to, symbol, quantity, eventStr) => {
  if (result.errors === undefined
  && result.events && result.events.find(el => (el.contract === 'tokens' || el.contract === 'burndollar') && el.event === eventStr
    && el.data.from === from && el.data.to === to && api.BigNumber(el.data.quantity).eq(quantity) && el.data.symbol === symbol) !== undefined) {
    return true;
  }

  return false;
};

const burnParentTokens = async (amount, fee, burnSymbol, toAccount, beedParams, isSignedWithActiveKey) => {
  if (api.BigNumber(fee).gt(0)) {
    const res = await api.executeSmartContract('tokens', 'transfer', {
      to: toAccount, symbol: burnSymbol, quantity: fee, isSignedWithActiveKey,
    });

    if (!isTokenTransferVerified(res, api.sender, toAccount, burnSymbol, fee, 'transfer')) {
      return false;
    }
  }

  const res2 = await api.executeSmartContract('tokens', 'transfer', {
    to: 'null', symbol: burnSymbol, quantity: amount, isSignedWithActiveKey,
  });


  const res3 = await api.executeSmartContract('tokens', 'transfer', {
    to: 'null', symbol: beedParams.burnToken, quantity: beedParams.burnUsageFee, isSignedWithActiveKey,
  });

  if (!isTokenTransferVerified(res2, api.sender, 'null', burnSymbol, amount, 'transfer')) {
    return false;
  }
  if (!isTokenTransferVerified(res3, api.sender, 'null', beedParams.burnToken, beedParams.burnUsageFee, 'transfer')) {
    return false;
  }
  return true;
};
// end utility functions

actions.createSSC = async () => {
  const tableExists = await api.db.tableExists('params');
  if (tableExists === false) {
    await api.db.createTable('params');
    await api.db.createTable('burnpair', ['symbol', 'parentSymbol']);
    const params = {};
    params.issueDTokenFee = '1000'; // BEED quantity
    params.updateParamsFee = '100'; // BEED quantity
    params.burnUsageFee = '1'; // BEED quantity
    params.minAmountConvertible = '1'; // XXX.d token minimum convert quantity issuer can update this;
    params.dTokenToIssuer = '1000'; // XXX.d token issued
    params.burnToken = 'BEED';

    await api.db.insert('params', params);
  }
};

actions.updateParams = async (payload) => {
  if (api.sender !== api.owner) return;

  const {
    issueDTokenFee,
    updateParamsFee,
    burnUsageFee,
    minAmountConvertible,
    dTokenToIssuer,
    burnToken,
  } = payload;

  const params = await api.db.findOne('params', {});
  if (issueDTokenFee && typeof issueDTokenFee === 'string' && !api.BigNumber(issueDTokenFee).isNaN() && api.BigNumber(issueDTokenFee).gte(1)) {
    params.issueDTokenFee = issueDTokenFee;
  }
  if (updateParamsFee && typeof updateParamsFee === 'string' && !api.BigNumber(updateParamsFee).isNaN() && api.BigNumber(updateParamsFee).gte(1)) {
    params.updateParamsFee = updateParamsFee;
  }
  if (burnUsageFee && typeof burnUsageFee === 'string' && !api.BigNumber(burnUsageFee).isNaN() && api.BigNumber(burnUsageFee).gte(1)) {
    params.burnUsageFee = burnUsageFee;
  }
  if (minAmountConvertible && typeof minAmountConvertible === 'string' && !minAmountConvertible.isNaN() && minAmountConvertible.gte(1)) {
    params.minAmountConvertible = minAmountConvertible;
  }
  if (dTokenToIssuer && typeof dTokenToIssuer === 'string' && !api.BigNumber(dTokenToIssuer).isNaN() && api.BigNumber(dTokenToIssuer).gte(1)) {
    params.dTokenToIssuer = dTokenToIssuer;
  }
  if (burnToken && typeof burnToken === 'string') {
    const findToken = await api.db.findOneInTable('tokens', 'tokens', { symbol: burnToken });

    if (findToken) {
      params.burnToken = burnToken;
    }
  }

  await api.db.update('params', params);
};

actions.createTokenD = async (payload) => {
  const {
    symbol, isSignedWithActiveKey, burnRouting, feePercentage,
  } = payload;

  const burnPairParams = {};
  const params = await api.db.findOne('params', {});
  const {
    issueDTokenFee,
  } = params;

  const beedTokenBalance = await api.db.findOneInTable('tokens', 'balances', { account: api.sender, symbol: params.burnToken });
  const authorizedCreation = beedTokenBalance && api.BigNumber(beedTokenBalance.balance).gte(issueDTokenFee);

  if (api.assert(isSignedWithActiveKey === true, 'you must use a custom_json signed with your active key')
   && api.assert(authorizedCreation, 'you must have enough BEED tokens cover the creation fees')
   && api.assert(symbol && typeof symbol === 'string' && symbol.length <= 8 && symbol.length > 0 && !symbol.includes('.D'), 'symbol must be string of length 8 or less to create a xxx.D token')
  ) {
    const tokenParent = await api.db.findOneInTable('tokens', 'tokens', { symbol });
    const finalRouting = burnRouting === undefined ? 'null' : burnRouting;

    if (api.assert(tokenParent.issuer === api.sender, 'You must be the token issuer in order to issue D token')
     && api.assert(api.isValidAccountName(finalRouting), 'burn routing must be a valid Hive account name')
    ) {
      if (api.assert(feePercentage && typeof feePercentage === 'string' && !api.BigNumber(feePercentage).isNaN() && api.BigNumber(feePercentage).gte(0) && api.BigNumber(feePercentage).lte(1) && countDecimals(feePercentage) <= 4, 'fee percentage must be between 0 and 1 / 0% and 100%')
      ) {
        let finalName = '';
        let dSymbol = '';
        dSymbol = `${symbol}.D`;
        const tokenDExists = await api.db.findOneInTable('tokens', 'tokens', { symbol: dSymbol });
        if (api.assert(tokenDExists === null, 'D token must not already exist')
       && api.assert((tokenParent.precision > 0) && (Number.isInteger(tokenParent.precision)), 'invalid precision')
        ) {
          finalName = `${symbol} stablecoin`;
          const newToken = {
            symbol: dSymbol,
            name: finalName,
            precision: tokenParent.precision,
            maxSupply: `${Number.MAX_SAFE_INTEGER}`,
          };

          await api.executeSmartContract('tokens', 'create', newToken);

          const tokenCreated = await verifyTokenCreation(dSymbol);

          if (!api.assert(tokenCreated, 'Token creation failed')) {
            return false;
          }

          burnPairParams.issuer = api.sender;
          burnPairParams.symbol = dSymbol;
          burnPairParams.precision = tokenParent.precision;
          burnPairParams.parentSymbol = symbol;
          burnPairParams.burnRouting = finalRouting;
          burnPairParams.feePercentage = feePercentage;

          await api.db.insert('burnpair', burnPairParams);

          // issue a number of XXX.D token to token issuer, issuer must create a market pool in order for conversions to occur(see actions.convert code)
          await api.executeSmartContract('tokens', 'issue', {
            to: api.sender, symbol: dSymbol, quantity: params.dTokenToIssuer,
          });

          if (api.BigNumber(issueDTokenFee).gt(0)) {
            await api.executeSmartContract('tokens', 'transfer', {
              to: 'null', symbol: params.burnToken, quantity: issueDTokenFee, isSignedWithActiveKey,
            });
          }
          api.emit('issued new token dollar stablecoin', {
            convertPercentage: feePercentage, feeRouting: burnPairParams.burnRouting, dSymbol,
          });
        }
      }
    }
  }
};

actions.updateBurnPair = async (payload) => {
  const {
    symbol,
    burnRouting,
    feePercentage,
    isSignedWithActiveKey,
  } = payload;

  const finalRouting = burnRouting === undefined ? 'null' : burnRouting;

  if (api.assert(api.isValidAccountName(finalRouting), 'account for burn routing must exist')) {
    if (api.assert(isSignedWithActiveKey === true, 'you must use a custom_json signed with your active key')
    && api.assert(symbol && typeof symbol === 'string', 'symbol must be string')
    && api.assert(finalRouting && typeof finalRouting === 'string', 'finalRouting must be string or null')
    && api.assert(feePercentage && typeof feePercentage === 'string' && !api.BigNumber(feePercentage).isNaN() && api.BigNumber(feePercentage).gte(0) && api.BigNumber(feePercentage).lte(1) && countDecimals(feePercentage) <= 4, 'fee percentage must be between 0 and 1 / 0% and 100%')
    ) {
      const token = await api.db.findOne('burnpair', { symbol });

      if (!api.assert(token !== null && token !== undefined, 'D token must exist')) {
        return false;
      }

      if (token) {
        if (api.assert(token.issuer === api.sender, 'must be the issuer')) {
          const params = await api.db.findOne('params', {});
          const { updateParamsFee } = params;
          const beedTokenBalance = await api.db.findOneInTable('tokens', 'balances', { account: api.sender, symbol: params.burnToken });
          const authorizedCreation = beedTokenBalance && api.BigNumber(beedTokenBalance.balance).gte(updateParamsFee);

          if (api.assert(authorizedCreation, 'you must have enough BEED tokens to cover the update properties fee')) {
            token.burnRouting = finalRouting;
            token.feePercentage = feePercentage;
            await api.db.update('burnpair', token);

            if (api.BigNumber(updateParamsFee).gt(0)) {
              await api.executeSmartContract('tokens', 'transfer', {
                to: 'null', symbol: params.burnToken, quantity: updateParamsFee, isSignedWithActiveKey,
              });
            }

            api.emit('updated params', {
              symbol, burnRouting, feePercentage,
            });
          }
        }
      }
    }
  }
};

actions.convert = async (payload) => {
  const {
    symbol, quantity, isSignedWithActiveKey,
  } = payload;

  if (api.assert(isSignedWithActiveKey === true, 'you must use a custom_json signed with your active key')
  && api.assert(quantity && typeof quantity === 'string' && !api.BigNumber(quantity).isNaN(), 'invalid params quantity')
  && api.assert(symbol && typeof symbol === 'string' && symbol.length > 0 && symbol.length <= 10, 'symbol must be string')) {
    const contractParams = await api.db.findOne('params', {});
    const parentPairParams = await api.db.findOne('burnpair', { parentSymbol: symbol });
    const qtyAsBigNum = api.BigNumber(quantity);
    if (api.assert(parentPairParams, 'parent symbol must have a child .D token')
    && api.assert(countDecimals(quantity) <= parentPairParams.precision, 'symbol precision mismatch')
    && api.assert(qtyAsBigNum.gte(contractParams.minAmountConvertible), 'amount to convert must be >= 1')) {
      const hasEnoughUtilityToken = await verifyTokenBalance(api.sender, contractParams.burnUsageFee, contractParams.burnToken);
      const hasEnoughParentBalance = await verifyTokenBalance(api.sender, qtyAsBigNum, symbol);
      const hasEnoughStablePool = await findMarketPools(symbol, 'stable');
      const hasEnoughMarketPool = await findMarketPools(symbol, 'market');

      if (api.assert(hasEnoughParentBalance, 'not enough token balance')
        && api.assert(hasEnoughUtilityToken, 'not enough utility tokens')
        && api.assert(hasEnoughStablePool, 'token must be in pool with a stable coin')
        && api.assert(hasEnoughMarketPool, 'token must be in pool with xxx.d token')) {
        const quoteOrBase = checkStablePosition(hasEnoughStablePool[0].tokenPair);
        let calcResultParentPool;

        if (quoteOrBase && quoteOrBase === 'base') {
          const stablePrice = hasEnoughStablePool[0].basePrice;
          const stableQuant = hasEnoughStablePool[0].baseQuantity;
          const tokenNameBase = hasEnoughStablePool[0].tokenPair.split(':')[1];
          const stableUSDValue = api.BigNumber(stablePrice).multipliedBy(stableQuant).toFixed(parentPairParams.precision, api.BigNumber.ROUND_DOWN);

          // Calulate the conservative value of the pool multiple the value of one side by 1.95, 1.95 used to ensure pools are not overvalued
          const finalValueQuote = api.BigNumber(stableUSDValue).multipliedBy(1.95).toFixed(parentPairParams.precision, api.BigNumber.ROUND_DOWN);

          // users to be be informed of $500 barrier to entry/ the difference of $100 (500 vs 400) is for wiggle room for ease of use
          if (!api.assert(finalValueQuote && finalValueQuote >= 400, 'stable token pool USD value must be at least 500')) {
            return false;
          }

          calcResultParentPool = await calcParentPool(tokenNameBase, hasEnoughMarketPool[0], stablePrice, parentPairParams.precision);
        } else if (quoteOrBase && quoteOrBase === 'quote') {
          const stableTPrice = hasEnoughStablePool[0].quotePrice;
          const quoteQuant = hasEnoughStablePool[0].quoteQuantity;
          const tokenNameQuote = hasEnoughStablePool[0].tokenPair.split(':')[0];
          const stableUSDValue = api.BigNumber(stableTPrice).multipliedBy(quoteQuant).toFixed(parentPairParams.precision, api.BigNumber.ROUND_DOWN);

          // calulate the conservative value of the pool multiple the value of one side by 1.95, 1.95 used to ensure pools are not overvalued
          const finalValueQuote = api.BigNumber(stableUSDValue).multipliedBy(1.95).toFixed(parentPairParams.precision, api.BigNumber.ROUND_DOWN);

          // users to be be informed of $500 barrier to entry/ the difference of $100 (500 vs 400) is for wiggle room for ease of use
          if (!api.assert(finalValueQuote && finalValueQuote >= 400, 'stable token pool USD value must be at least 500')) {
            return false;
          }
          calcResultParentPool = await calcParentPool(tokenNameQuote, hasEnoughMarketPool[0], stableTPrice, parentPairParams.precision);
        }

        if (api.assert(calcResultParentPool && calcResultParentPool.poolValueUSD >= 400, 'parent token and XXX.D token pool USD value must be at least 500')) {
          const feePercentage = api.BigNumber(parentPairParams.feePercentage);
          let fee = '0';
          let finalQty = qtyAsBigNum;

          if (feePercentage.gt(0)) {
            fee = qtyAsBigNum.multipliedBy(feePercentage).toFixed(parentPairParams.precision, api.BigNumber.ROUND_UP);
            finalQty = qtyAsBigNum.minus(fee);
          }
          const xxxdToIssue = finalQty.multipliedBy(calcResultParentPool.parentPrice).toFixed(parentPairParams.precision, api.BigNumber.ROUND_DOWN);

          if (!api.assert(api.BigNumber(xxxdToIssue).gt(contractParams.minAmountConvertible), `resulting token issuance is too small; token price is ${calcResultParentPool.parentPrice}`)) {
            return false;
          }
          const isBurnSuccess = await burnParentTokens(finalQty, fee, parentPairParams.parentSymbol, parentPairParams.burnRouting, contractParams, isSignedWithActiveKey);

          if (!api.assert(isBurnSuccess, 'error on token burn')) {
            return false;
          }

          await api.executeSmartContract('tokens', 'issue', {
            to: api.sender, symbol: parentPairParams.symbol, quantity: xxxdToIssue,
          });

          const keyname = parentPairParams.parentSymbol;

          api.emit('Converted token to dollar token', {
            symbol: parentPairParams.symbol, fee, feeRouting: parentPairParams.burnRouting, parentSymbol: keyname, precision: parentPairParams.precision, childIssued: xxxdToIssue, parentPriceInUSD: calcResultParentPool.parentPrice,
          });
        }
      }
    }
  }
};
