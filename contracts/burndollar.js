/* eslint-disable no-await-in-loop */
/* eslint-disable no-template-curly-in-string */
/* eslint-disable valid-typeof */
/* eslint-disable max-len */
/* eslint-disable no-continue */
/* global actions, api */

// define stable coins allowed in functions
const stablePairArray = ['SWAP.HBD', 'SWAP.USDT', 'SWAP.DAI', 'SWAP.USDC'];

// begin utility functions
const countDecimals = value => api.BigNumber(value).dp();

const verifyTokenBalance = async (account, beedParams, amount, symbolFind, toggle) => {
  const { burnUsageFee } = beedParams;

  if (toggle === 'toggleOn') { // ensure XXX.D token was created
    const createD = await api.db.findOneInTable('tokens', 'tokens', { symbol: symbolFind });

    if (!createD) {
      return false;
    }
  }
  const userBeed = await api.db.findOneInTable('tokens', 'balances', { account, symbol: 'BEED' });

  api.assert(userBeed && api.BigNumber(userBeed.balance).gte(burnUsageFee), 'not enough BEED balance');

  const parentTokenBalance = await api.db.findOneInTable('tokens', 'balances', { account, symbol: symbolFind });
  if (parentTokenBalance && api.BigNumber(parentTokenBalance.balance).gte(amount)) {
    return true;
  }
  return false;
};

const checkStablePosition = (tokenPair) => {
  const [firstToken, secondToken] = tokenPair.split(':');

  // Check if the stable pair is before or after the colon
  if (stablePairArray.includes(firstToken)) {
    return 'base'; // Stable coin is before the colon and in the market pool and therefore the base price
  } if (stablePairArray.includes(secondToken)) {
    return 'quote'; // Stable coin is after the colon in the marketpool and therefore is the quote price
  }
  return false; // No stable pair found in the token pair
};

const findMarketPools = async (parentSymbol, toggle) => {
// Define child symbol
  const childSymbol = `${parentSymbol}.D`;
  let poolData;

  if (toggle === 'stable') {
  // Define parent-child token pairs
    const stableParentArray = [`${parentSymbol}`, `${childSymbol}`];

    // Create an array of all possible token pairs
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
  // Define parent-child token pairs
    const marketParentArray = [`${parentSymbol}:${childSymbol}`, `${childSymbol}:${parentSymbol}`];

    // Use a single database query to fetch all relevant pools
    poolData = await api.db.findInTable('marketpools', 'pools', {
      tokenPair: { $in: marketParentArray },
    });
  }
  // Process results and construct the valid pools array
  const validPools = poolData.map(pool => ({
    tokenPair: pool.tokenPair,
    basePrice: pool.basePrice || '0',
    quotePrice: pool.quotePrice || '0',
    baseQuantity: pool.baseQuantity || '0',
    quoteQuantity: pool.quoteQuantity || '0',
  }));

  // Return validPools or null if no pools are found
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

  // Check if the match is before or after the colon
  if (name.includes(firstToken)) {
  // Match is before the colon in the marketpool and therefore is the quote price
    quoteOrBasePosition = 'base';
  } if (name.includes(secondToken)) {
    quoteOrBasePosition = 'quote';
    // Match is after the colon and in the market pool and therefore the base price
  }
  // perform calc based on first position === base
  if (quoteOrBasePosition && quoteOrBasePosition === 'base') {
  // we have the price of one token from the stable pool calc, we need to calc the price of the token's pair
    otherTokenPriceUSD = api.BigNumber(pool.quotePrice).multipliedBy(tokenPriceUSD).toFixed(precision, api.BigNumber.ROUND_DOWN);
    // determine if base token is the xxx.D
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
  } else if (quoteOrBasePosition && quoteOrBasePosition === 'quote') { // perform calc based on second postion === quote
  // we have the price of one token from the stable pool calc, we need to calc the price of the token's pair
    otherTokenPriceUSD = api.BigNumber(pool.basePrice).multipliedBy(tokenPriceUSD).toFixed(precision, api.BigNumber.ROUND_DOWN);

    // determine if quote token is the xxx.D
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
  && result.events && result.events.find(el => el.contract === 'tokens' && el.event === eventStr
    && el.data.from === from && el.data.to === to && el.data.quantity === quantity && el.data.symbol === symbol) !== undefined) {
    return true;
  }
  return false;
};

const burnParentTokens = async (amount, fee, burnSymbol, toAccount, beedParams, isSignedWithActiveKey) => {
  if (api.BigNumber(fee).gte(0)) {
  // tranfer fee to the burn routing if any
    const res = await api.executeSmartContract('tokens', 'transfer', {
      to: toAccount, symbol: burnSymbol, quantity: fee, isSignedWithActiveKey,
    });
    if (isTokenTransferVerified(res, api.sender, toAccount, burnSymbol, amount, 'transfer')) {
      return false;
    }
  }
  // burn the remainder to null
  const res2 = await api.executeSmartContract('tokens', 'transfer', {
    to: 'null', symbol: burnSymbol, quantity: amount, isSignedWithActiveKey,
  });

  // burn the BEED for required will only perform if fee > 0
  const res3 = await api.executeSmartContract('tokens', 'transfer', {
    to: 'null', symbol: 'BEED', quantity: beedParams.burnUsageFee, isSignedWithActiveKey,
  });
  // check if the tokens were sent
  if (!isTokenTransferVerified(res2, api.sender, 'null', burnSymbol, amount, 'transfer')) {
    return false;
  }
  if (!isTokenTransferVerified(res3, api.sender, 'null', 'BEED', beedParams.burnUsageFee, 'transfer')) {
    return false;
  }
};
// end utility functions

actions.createSSC = async () => {
  const tableExists = await api.db.tableExists('params');
  if (tableExists === false) {
    await api.db.createTable('params');
    await api.db.createTable('burnpair', ['symbol']);
    const params = {};
    params.issueDTokenFee = '1000';
    params.updateParamsFee = '100';
    params.burnUsageFee = '1';
    params.minAmountConvertible = '1';
    params.dTokenToIssuer = '1000';
    params.compairMinimum = '1';

    await api.db.insert('params', params);
  }
};

actions.updateParams = async (payload) => { //    this function will update the parameters of the burndollar_params collection
  if (api.sender !== api.owner) return;

  const {
    issueDTokenFee,
    updateParamsFee,
    burnUsageFee,
  } = payload;

  const params = await api.db.findOne('params', {});

  if (issueDTokenFee && typeof issueDTokenFee === 'string' && !api.BigNumber(issueDTokenFee).isNaN() && api.BigNumber(issueDTokenFee).gte(params.compairMinimum)) {
    params.issueDTokenFee = issueDTokenFee;
  }
  if (updateParamsFee && typeof updateParamsFee === 'string' && !api.BigNumber(updateParamsFee).isNaN() && api.BigNumber(updateParamsFee).gte(params.compairMinimum)) {
    params.updateParamsFee = updateParamsFee;
  }
  if (burnUsageFee && typeof burnUsageFee === 'string' && !api.BigNumber(burnUsageFee).isNaN() && api.BigNumber(burnUsageFee).gte(params.compairMinimum)) {
    params.burnUsageFee = burnUsageFee;
  }
  await api.db.update('params', params);
};

actions.createTokenD = async (payload) => { // allow a token_owner to create the new D Token
  const {
    symbol, isSignedWithActiveKey, burnRouting, feePercentage,
  } = payload;

  const burnPairParams = {};
  const params = await api.db.findOne('params', {});
  const {
    issueDTokenFee,
    minAmountConvertible,
    compairMinimum,

  } = params;
  const beedTokenBalance = await api.db.findOneInTable('tokens', 'balances', { account: api.sender, symbol: 'BEED' });

  if (issueDTokenFee <= 0) {
    api.assert(issueDTokenFee >= 0, `fee for XXX.D creation must be greater than zero ${issueDTokenFee}`);
    return false;
  }
  const authorizedCreation = beedTokenBalance && api.BigNumber(beedTokenBalance.balance).gte(issueDTokenFee);

  if (!isSignedWithActiveKey || isSignedWithActiveKey === false) {
    api.assert(isSignedWithActiveKey === true, 'you must use a custom_json signed with your active key');
    return false;
  }
  if (api.assert(authorizedCreation && beedTokenBalance.balance >= issueDTokenFee, 'you must have enough BEED tokens cover the creation fees')
   && api.assert(symbol && typeof symbol === 'string' && symbol.length <= 8 && symbol.length > 0 && !symbol.includes('.D'), 'symbol must be string of length 8 or less to create a xxx-D token')
  ) {
  // ensure the user issuing D token is owner of the parent pair token
    const tokenParent = await api.db.findOneInTable('tokens', 'tokens', { symbol });
    const finalRouting = burnRouting === undefined ? 'null' : burnRouting;

    if (api.assert(tokenParent.issuer === api.sender, 'You must be the token issuer in order to issue D token')
     && api.assert(api.isValidAccountName(finalRouting), 'burn routing must be string')
     && api.assert(minAmountConvertible && typeof minAmountConvertible === 'string' && !api.BigNumber(minAmountConvertible).isNaN() && api.BigNumber(minAmountConvertible).gte(compairMinimum), 'min convert amount must be string(number) greater than 1')
    ) {
      if (api.assert(feePercentage && typeof feePercentage === 'string' && !api.BigNumber(feePercentage).isNaN() && api.BigNumber(feePercentage).gte(0) && api.BigNumber(feePercentage).lte(1) && api.BigNumber(((feePercentage * 1000) % 1 === 0)), 'fee percentage must be between 0 and 1 / 0% and 100%')
      ) {
        let finalName = '';
        let dSymbol = '';
        dSymbol = `${symbol}.D`;
        const tokenDExists = await api.db.findOneInTable('tokens', 'tokens', { symbol: dSymbol });
        if (api.assert(api.isValidAccountName(api.sender), 'account for burn routing must exist')
       && api.assert(tokenDExists === null, 'D token must not already exist')
       && api.assert((tokenParent.precision > 0 && tokenParent.precision <= 8) && (Number.isInteger(tokenParent.precision)), 'invalid precision')
        ) {
          finalName = `${symbol} is the parent of ${symbol} dollar`;
          const newToken = {
            symbol: dSymbol,
            name: finalName,
            precision: tokenParent.precision,
            maxSupply: `${Number.MAX_SAFE_INTEGER}`,
          };
          // create the new XXX.D token
          await api.executeSmartContract('tokens', 'create', newToken);

          verifyTokenBalance(api.sender, params, 0, dSymbol, 'toggleOn');

          burnPairParams.issuer = api.sender;
          burnPairParams.symbol = dSymbol;
          burnPairParams.precision = tokenParent.precision;
          burnPairParams.parentSymbol = symbol;
          burnPairParams.burnRouting = finalRouting;
          burnPairParams.feePercentage = feePercentage;

          // insert record into burnpair table, which contains the Parent token and the params for the child (XXX.D) token
          await api.db.insert('burnpair', burnPairParams);

          // issue 1000 XXX.D token to token issuer, issuer must create a market pools in order for conversions to occur(see actions.convert code)
          await api.executeSmartContract('tokens', 'issue', {
            to: api.sender, symbol: dSymbol, quantity: params.dTokenToIssuer,
          });
          // burn BEED at the rate specified from the burndollar_ params table
          if (api.BigNumber(issueDTokenFee).gt(0)) {
            await api.executeSmartContract('tokens', 'transfer', {
              to: 'null', symbol: 'BEED', quantity: issueDTokenFee, isSignedWithActiveKey,
            });
          }
          api.emit('issued new token dollar token', {
            usefee: params.minAmountConvertible, feeRouting: burnPairParams.burnRouting, dSymbol,
          });
        }
      }
    }
  }
};

actions.updateBurnPair = async (payload) => { //    this function will update the parameters of the D token in the burnpair table
  const {
    symbol,
    burnRouting,
    feePercentage,
    isSignedWithActiveKey,
  } = payload;

  const finalRouting = burnRouting === undefined ? 'null' : burnRouting;
  const burnAccount = await api.db.findOneInTable('tokens', 'balances', { account: burnRouting });

  if (api.assert(burnAccount !== null, 'account for burn routing must exist')) {
    if (api.assert(isSignedWithActiveKey === true, 'you must use a custom_json signed with your active key')
    && api.assert(symbol && typeof symbol === 'string', 'symbol must be string')
    && api.assert(finalRouting && typeof finalRouting === 'string', 'burnroute must be string or null')
    && api.assert(feePercentage && typeof feePercentage === 'string' && !api.BigNumber(feePercentage).isNaN() && api.BigNumber(feePercentage).gte(0) && api.BigNumber(feePercentage).lte(1), 'fee percentage must be between 0 and 1 / 0% and 100%')
    ) {
      const token = await api.db.findOne('burnpair', { symbol });

      api.assert(token !== null && token !== undefined, 'D token must exist');

      if (token) {
        if (api.assert(token.issuer === api.sender, 'must be the issuer')) {
          const params = await api.db.findOne('params', {});
          const { updateParamsFee } = params;
          const beedTokenBalance = await api.db.findOneInTable('tokens', 'balances', { account: api.sender, symbol: 'BEED' });
          const authorizedCreation = beedTokenBalance && api.BigNumber(beedTokenBalance.balance).gte(updateParamsFee);

          if (api.assert(authorizedCreation, 'you must have enough BEED tokens to cover the creation fees')) {
            token.burnRouting = finalRouting;
            token.feePercentage = feePercentage;
            await api.db.update('burnpair', token);

            if (api.BigNumber(updateParamsFee).gt(0)) {
              await api.executeSmartContract('tokens', 'transfer', {
                to: 'null', symbol: 'BEED', quantity: updateParamsFee, isSignedWithActiveKey,
              });
            }
          }
        }
      }
    }
  }
};

actions.convert = async (payload) => { // allows any user who has parent token to convert to xxx.D token given there is suffcient marketpools
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
      const hasEnoughParentBalance = await verifyTokenBalance(api.sender, contractParams, qtyAsBigNum, symbol, 'toggleOff');
      const hasEnoughStablePool = await findMarketPools(symbol, 'stable');
      const hasEnoughMarketPool = await findMarketPools(symbol, 'market');

      if (api.assert(hasEnoughParentBalance, 'not enough parent token to convert')
        && api.assert(hasEnoughStablePool, 'token must be in pool with a stable coin')
        && api.assert(hasEnoughMarketPool, 'token must be in pool with xxx.d token')) {
        const quoteOrBase = checkStablePosition(hasEnoughStablePool[0].tokenPair);
        let calcResultParentPool;

        if (quoteOrBase && quoteOrBase === 'base') {
          const stablePrice = hasEnoughStablePool[0].basePrice;
          const stableQuant = hasEnoughStablePool[0].baseQuantity;
          const tokenNameBase = hasEnoughStablePool[0].tokenPair.split(':')[1];
          const stableUSDValue = api.BigNumber(stablePrice).multipliedBy(stableQuant).toFixed(parentPairParams.precision, api.BigNumber.ROUND_DOWN);

          // marketpool balance the value of 1 token versus the other to get a conservative value of the pool multiple the value of one side by 1.95
          const finalValueQuote = api.BigNumber(stableUSDValue).multipliedBy(1.95).toFixed(parentPairParams.precision, api.BigNumber.ROUND_DOWN);

          // users to be be informed of $500 barrier to entry/ delta of 100 (500 vs 400) is for wiggle room for ease of use
          if (finalValueQuote && finalValueQuote < 400) {
            api.assert(finalValueQuote && finalValueQuote >= 400, 'stable token pool USD value must be at least 500');
            return false;
          }

          calcResultParentPool = await calcParentPool(tokenNameBase, hasEnoughMarketPool[0], stablePrice, parentPairParams.precision);
        } else if (quoteOrBase && quoteOrBase === 'quote') {
          const stableTPrice = hasEnoughStablePool[0].quotePrice;
          const quoteQuant = hasEnoughStablePool[0].quoteQuantity;
          const tokenNameQuote = hasEnoughStablePool[0].tokenPair.split(':')[0];
          const stableUSDValue = api.BigNumber(stableTPrice).multipliedBy(quoteQuant).toFixed(parentPairParams.precision, api.BigNumber.ROUND_DOWN);

          // marketpool balance the value of 1 token versus the other to get a conservative value of the pool multiple the value of one side by 1.95
          const finalValueQuote = api.BigNumber(stableUSDValue).multipliedBy(1.95).toFixed(parentPairParams.precision, api.BigNumber.ROUND_DOWN);

          // users to be be informed of $500 barrier to entry/ delta of 100 (500 vs 400) is for wiggle room for ease of use
          if (finalValueQuote && finalValueQuote < 400) {
            api.assert(finalValueQuote && finalValueQuote >= 400, 'stable token pool USD value must be at least 500');
            return false;
          }
          calcResultParentPool = await calcParentPool(tokenNameQuote, hasEnoughMarketPool[0], stableTPrice, parentPairParams.precision);
        }

        // users to be be informed of $500 barrier to entry/ delta of 100 (500 vs 400) is for wiggle room for ease of use
        if (api.assert(calcResultParentPool && calcResultParentPool.poolValueUSD >= 400, 'parent token and XXX.D token pool USD value must be at least 500')) {
        // subtract the conversion fee from the amount to be converted
          const feePercentage = api.BigNumber(parentPairParams.feePercentage);
          let fee = '0';
          let finalQty = qtyAsBigNum;

          if (feePercentage.gt(0)) {
            fee = qtyAsBigNum.multipliedBy(feePercentage).toFixed(parentPairParams.precision, api.BigNumber.ROUND_UP);
            finalQty = qtyAsBigNum.minus(fee);
          }
          const xxxdToIssue = finalQty.multipliedBy(calcResultParentPool.parentPrice).toFixed(parentPairParams.precision, api.BigNumber.ROUND_DOWN);

          if (!api.assert(api.BigNumber(xxxdToIssue).gt(contractParams.compairMinimum), `resulting token issuance is too small; token price is ${calcResultParentPool.parentPrice}`)) {
            return false;
          }
          const burnResults = burnParentTokens(finalQty, fee, parentPairParams.parentSymbol, parentPairParams.burnRouting, contractParams, isSignedWithActiveKey);
          api.assert(burnResults, 'error on token burn');

          // finally, issue the new XXX.D
          await api.executeSmartContract('tokens', 'issue', {
            to: api.sender, symbol: parentPairParams.symbol, quantity: xxxdToIssue,
          });

          const keyname = parentPairParams.parentSymbol;
          const childName = parentPairParams.symbol;

          api.emit('Converted token to dollar token', {
            symbol: parentPairParams.symbol, fee, feeRouting: parentPairParams.burnRouting, parentSymbol: keyname, precision: qtyAsBigNum.toFixed(parentPairParams.precision), childSymbol: childName, childIssued: xxxdToIssue, parentPriceInUSD: calcResultParentPool.parentPrice,
          });
        }
      }
    }
  }
  return false;
};
