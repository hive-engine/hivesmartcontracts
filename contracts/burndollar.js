/* eslint-disable no-await-in-loop */
/* eslint-disable no-template-curly-in-string */
/* eslint-disable valid-typeof */
/* eslint-disable max-len */
/* eslint-disable no-continue */
/* global actions, api */

// begin utility functions
const countDecimals = value => api.BigNumber(value).dp();

const verifyUtilityTokenBalance = async (account) => {
  if (!account) {
    throw new Error('Missing required parameters: account');
  }

  const beedParams = await api.db.findOne('params', {});
  const { burnUsageFee } = beedParams;

  if (api.BigNumber(burnUsageFee).lte(0)) {
    return true;
  }
  const utilityTokenBalance = await api.db.findOneInTable('tokens', 'balances', { account, symbol: 'BEED' });
  if (utilityTokenBalance && api.BigNumber(utilityTokenBalance.balance).gte(burnUsageFee)) {
    return true;
  }
  return false;
};

const verifyParentTokenBalance = async (account, amount, symbolFind) => {
  if (!account || !amount || !symbolFind) {
    throw new Error('Missing required parameters: account, amount, symbolFind');
  }

  if (api.BigNumber(amount).lte(0)) {
    return true;
  }
  const parentTokenBalance = await api.db.findOneInTable('tokens', 'balances', { account, symbol: symbolFind });
  if (parentTokenBalance && api.BigNumber(parentTokenBalance.balance).gte(amount)) {
    return true;
  }
  return false;
};

const checkStablePosition = (tokenPair) => {
  if (!tokenPair) {
    throw new Error('Missing required parameters: tokenPair');
  }
  const [firstToken, secondToken] = tokenPair.split(':'); // Split the token pair by ":"

  const stablePairArray = ['SWAP.HBD', 'SWAP.USDT', 'SWAP.DAI', 'SWAP.USDC'];
  // Check if the stable pair is before or after the colon
  if (stablePairArray.includes(firstToken)) {
    return 'base'; // Stable coin is before the colon and in the market pool and therefore the base price
  } if (stablePairArray.includes(secondToken)) {
    return 'quote'; // Stable coin is after the colon in the marketpool and therefore is the quote price
  }
  return false; // No stable pair found in the token pair
};

const findStablePools = async (parentSymbol) => {
  if (!parentSymbol) {
    throw new Error(`Missing required parameters: findStablePools ${parentSymbol}`);
  }

  // define child symbol
  const childSymbol = `${parentSymbol}.D`;

  // Define Stable coins

  const stablePairArray = ['SWAP.HBD', 'SWAP.USDT', 'SWAP.DAI', 'SWAP.USDC'];

  // Define parent-child token pairs
  const parentPairArray = [`${parentSymbol}`, `${childSymbol}`];

  // create array of market pools a user could create for a  stable coin / XXX or XXX.D
  const stableResults = parentPairArray.flatMap(pElement => stablePairArray.flatMap(sElement => [
    `${sElement}:${pElement}`,
    `${pElement}:${sElement}`,
  ]));

  try {
    const results = await Promise.all(
      stableResults.map(async (tokenPair) => {
        const stablePool = await api.db.findOneInTable('marketpools', 'pools', { tokenPair });
        return stablePool
          ? {
            tokenPair,
            basePrice: stablePool.basePrice || '0',
            quotePrice: stablePool.quotePrice || '0',
            baseQuantity: stablePool.baseQuantity || '0',
            quoteQuantity: stablePool.quoteQuantity || '0',
          }
          : null; // Return null for invalid pools // Return the element directly if a pool is found
      }),
    );

    // Return the valid elements

    const stablePools = results.filter(pool => pool !== null && pool !== undefined);
    return stablePools.length > 0 ? stablePools : false; // Return stablePools or false if empty
  } catch (error) {
    return false;
  }
};

const findMarketPools = async (parentSymbol) => {
  // Validate parentSymbol
  if (!parentSymbol) {
    throw new Error(`Missing required parameters: findMarketPools ${parentSymbol}`);
  }

  // Create the child symbol
  const childSymbol = `${parentSymbol}.D`;

  // Define parent-child token pairs
  const parentPair = [`${parentSymbol}:${childSymbol}`, `${childSymbol}:${parentSymbol}`];

  try {
    // Query the database for each token pair and associate results with pool data
    const results = await Promise.all(
      parentPair.map(async (tokenPair) => {
        const parentChildPool = await api.db.findOneInTable('marketpools', 'pools', { tokenPair });
        // If the pool is found, return an object with tokenPair, basePrice, and quotePrice
        return parentChildPool
          ? {
            tokenPair,
            basePrice: parentChildPool.basePrice || '0',
            quotePrice: parentChildPool.quotePrice || '0',
            baseQuantity: parentChildPool.baseQuantity || '0',
            quoteQuantity: parentChildPool.quoteQuantity || '0',
          }
          : null; // Return false for invalid pools
      }),
    );

    const validPools = results.filter(pool => pool !== null && pool !== undefined);
    return validPools.length > 0 ? validPools : false; // Return validPools or false if empty
  } catch (error) {
    return false;
  }
};


const calcParentPool = async (name, pool, tokenPriceUSD, precision) => {
  if (!name || !pool || !tokenPriceUSD || !precision) {
    throw new Error('Missing required parameters: name, pool, tokenPriceUSD, or precision');
  }


  const [firstToken, secondToken] = pool.tokenPair.split(':'); // Split the token pair by ":"

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
    // conservative value of the pool multiple the value the halfpool by 1.95
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
    // conservative value of the pool multiple the value the halfpool by 1.95
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

const burnParentTokens = async (amount, fee, burnSymbol, toAccount, isSignedWithActiveKey) => {
  if (!amount || !burnSymbol || !toAccount || !isSignedWithActiveKey) {
    throw new Error('Missing required parameters: in burnParentTokens');
  }
  if (api.BigNumber(fee).gte(0) || api.BigNumber(amount).gte(0)) {
    // tranfer fee to the burn routing if any
    const res = await api.executeSmartContract('tokens', 'transfer', {
      to: toAccount, symbol: burnSymbol, quantity: fee, isSignedWithActiveKey,
    });

    const res2 = await api.executeSmartContract('tokens', 'transfer', {
      to: 'null', symbol: burnSymbol, quantity: amount, isSignedWithActiveKey,
    });
    // check if the tokens were sent
    if (!isTokenTransferVerified(res, api.sender, toAccount, burnSymbol, amount, 'transfer')) {
      return false;
    }
    if (!isTokenTransferVerified(res2, api.sender, 'null', burnSymbol, amount, 'transfer')) {
      return false;
    }
  }
  return true;
};

// end utility functions

actions.createSSC = async () => {
  const tableExists = await api.db.tableExists('params');
  if (tableExists === false) {
    await api.db.createTable('params');

    await api.db.createTable('burnpair', ['issuer', 'symbol', 'name', 'precision', 'parentSymbol', 'burnRouting', 'minConvertibleAmount', 'feePercentage', 'callingContractInfo']);

    const params = {};
    params.issueDTokenFee = '1000';
    params.updateParamsFee = '100';
    params.burnUsageFee = '1';
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


  if (issueDTokenFee && typeof issueDTokenFee === 'string' && !api.BigNumber(issueDTokenFee).isNaN() && api.BigNumber(issueDTokenFee).gte(0)) {
    params.issueDTokenFee = issueDTokenFee;
  }

  if (updateParamsFee && typeof updateParamsFee === 'string' && !api.BigNumber(updateParamsFee).isNaN() && api.BigNumber(updateParamsFee).gte(0)) {
    params.updateParamsFee = updateParamsFee;
  }
  if (burnUsageFee && typeof burnUsageFee === 'string' && !api.BigNumber(burnUsageFee).isNaN() && api.BigNumber(burnUsageFee).gte(0)) {
    params.burnUsageFee = burnUsageFee;
  }

  await api.db.update('params', params);
};

actions.createTokenD = async (payload) => { // allow a token_owner to create the new D Token
  const { // not sure if I need name for blacklist or callingContractInfo
    name, symbol, precision, maxSupply, isSignedWithActiveKey, burnRouting, minConvertibleAmount, feePercentage,
  } = payload;

  const params = await api.db.findOne('params', {});
  const { issueDTokenFee } = params;

  const beedTokenBalance = await api.db.findOneInTable('tokens', 'balances', { account: api.sender, symbol: 'BEED' });

  const authorizedCreation = beedTokenBalance && api.BigNumber(beedTokenBalance.balance).gte(issueDTokenFee);

  if (api.assert(authorizedCreation, 'you must have enough BEED tokens to cover the creation fees')
   && api.assert(symbol && typeof symbol === 'string' && symbol.length <= 8, 'symbol must be string of length 8 or less to create a xxx-D token')
  ) {
    // ensure the user issuing D token is owner of the parent pair token
    const tokenIssuer = await api.db.findOneInTable('tokens', 'tokens', { issuer: api.sender, symbol });

    const finalRouting = burnRouting === undefined ? 'null' : burnRouting;
    if (api.assert(tokenIssuer !== null, 'You must be the token issuer in order to issue D token')
    && api.assert(finalRouting === null || (typeof finalRouting === 'string'), 'burn routing must be string')
    && api.assert(minConvertibleAmount && typeof minConvertibleAmount === 'string' && !api.BigNumber(minConvertibleAmount).isNaN() && api.BigNumber(minConvertibleAmount).gte(1), 'min convert amount must be string(number) greater than 1')
    && api.assert(feePercentage && typeof feePercentage === 'string' && !api.BigNumber(feePercentage).isNaN() && api.BigNumber(feePercentage).gte(0) && api.BigNumber(feePercentage).lte(1), 'fee percentage must be between 0 and 1 / 0% and 100%')
    && api.assert(maxSupply && typeof maxSupply === 'string' && !api.BigNumber(maxSupply).isNaN() && api.BigNumber(maxSupply).gte(1000), 'max supply must be a minimum of 1000 units')
    ) {
      const burnAccount = await api.db.findOneInTable('tokens', 'balances', { account: burnRouting });
      let dsymbol = '';
      dsymbol = `${symbol}.D`;
      const tokenDExists = await api.db.findOneInTable('tokens', 'tokens', { symbol: dsymbol });
      if (api.assert(burnAccount !== null, 'account for burn routing must exist')
        && api.assert(tokenDExists === null, 'D token must not already exist')
      ) {
        try {
          const finalname = name === undefined ? 'null' : name;

          const newToken = {
            issuer: api.sender,
            symbol: dsymbol,
            name: finalname,
            precision,
            maxSupply: api.BigNumber(maxSupply).toFixed(precision),
            supply: '0',
            circulatingSupply: '0',
            stakingEnabled: false,
            unstakingCooldown: 1,
            delegationEnabled: false,
            undelegationCooldown: 0,
          };

          // create the new XXX.D token
          await api.executeSmartContract('tokens', 'create', newToken);


          const burnPairParams = {
            issuer: api.sender,
            symbol: dsymbol,
            precision,
            name: finalname,
            parentSymbol: symbol,
            burnRouting: finalRouting,
            minConvertibleAmount,
            feePercentage,
          };

          // insert record into burnpair table, which contains the Parent token and the params for the child (XXX.D) token
          await api.db.insert('burnpair', burnPairParams);

          // issue 1000 XXX.D token to token issuer, issuer must create a market pools in order for conversions to occur(see actions.convert code)
          await api.executeSmartContract('tokens', 'issue', {
            to: api.sender, symbol: dsymbol, quantity: '1000',
          });


          // burn BEED at the rate specified from the burndollar_ params table
          if (api.BigNumber(issueDTokenFee).gt(0)) {
            await api.executeSmartContract('tokens', 'transfer', {
              to: 'null', symbol: 'BEED', quantity: issueDTokenFee, isSignedWithActiveKey,
            });
          }
        } catch (error) {
          // Handle any errors that occur during the await calls source is token.js
          return false;
        }
      }
    }
  }
  return true;
};


actions.updateBurnPair = async (payload) => { //    this function will update the parameters of the D token in the burnpair table
  //! !  Allow token issuer to controll the precision, META Data, and MAXSupply visa viw this update?
  const {
    symbol,
    name,
    burnRouting,
    feePercentage,
    isSignedWithActiveKey,
  } = payload;

  const finalRouting = burnRouting === undefined ? 'null' : burnRouting;
  const finalName = name === undefined ? '' : name;

  const burnAccount = await api.db.findOneInTable('tokens', 'balances', { account: burnRouting });
  if (api.assert(burnAccount !== null, 'account for burn routing must exist')) {
    if (api.assert(isSignedWithActiveKey === true, 'you must use a custom_json signed with your active key')
    && api.assert(symbol && typeof symbol === 'string', 'symbol must be string')
    && api.assert(finalName && typeof finalName === 'string', 'token name must be string')
    && api.assert(api.validator.isAlphanumeric(api.validator.blacklist(finalName, ' ')) && finalName.length > 0 && finalName.length <= 50, 'invalid name: letters, numbers, whitespaces only, max length of 50')
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
            token.name = finalName;
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
  return true;
};


actions.convert = async (payload) => { // allows any user who has parent token to convert to xxx.D token given there is suffcient marketpools
  const {
    symbol, quantity, isSignedWithActiveKey,
  } = payload;


  if (api.assert(isSignedWithActiveKey === true, 'you must use a custom_json signed with your active key')
    && api.assert(quantity && typeof quantity === 'string' && !api.BigNumber(quantity).isNaN(), 'invalid params quantity')
    && api.assert(symbol && typeof symbol === 'string', 'symbol must be string')) {
    const parentPairParams = await api.db.findOne('burnpair', { parentSymbol: symbol });
    const qtyAsBigNum = api.BigNumber(quantity);
    if (api.assert(parentPairParams, 'parent symbol must have a child .D token')
      && api.assert(qtyAsBigNum.gte(parentPairParams.minConvertibleAmount), `amount to convert must be >= ${parentPairParams.minConvertibleAmount}`)
      && api.assert(countDecimals(quantity) <= parentPairParams.precision, 'symbol precision mismatch')) {
      const hasEnoughBeedBalance = await verifyUtilityTokenBalance(api.sender);
      const hasEnoughParentBalance = await verifyParentTokenBalance(api.sender, qtyAsBigNum, symbol);
      const hasEnoughStablePool = await findStablePools(symbol);
      const hasEnoughMarketPool = await findMarketPools(symbol);


      if (api.assert(hasEnoughBeedBalance, 'not enough BEED balance')
          && api.assert(hasEnoughParentBalance, 'not enough parent token to convert')
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
          if (api.assert(finalValueQuote && finalValueQuote >= 400, 'stable token pool USD value must be at least 500')) {
            calcResultParentPool = await calcParentPool(tokenNameBase, hasEnoughMarketPool[0], stablePrice, parentPairParams.precision);
          }
        } else if (quoteOrBase && quoteOrBase === 'quote') {
          const stableTPrice = hasEnoughStablePool[0].quotePrice;
          const quoteQuant = hasEnoughStablePool[0].quoteQuantity;
          const tokenNameQuote = hasEnoughStablePool[0].tokenPair.split(':')[0];

          const stableUSDValue = api.BigNumber(stableTPrice).multipliedBy(quoteQuant).toFixed(parentPairParams.precision, api.BigNumber.ROUND_DOWN);

          // marketpool balance the value of 1 token versus the other to get a conservative value of the pool multiple the value of one side by 1.95
          const finalValueQuote = api.BigNumber(stableUSDValue).multipliedBy(1.95).toFixed(parentPairParams.precision, api.BigNumber.ROUND_DOWN);

          // users to be be informed of $500 barrier to entry/ delta of 100 (500 vs 400) is for wiggle room for ease of use
          if (api.assert(finalValueQuote && finalValueQuote >= 400, 'stable token pool USD value must be at least 500')) {
            calcResultParentPool = await calcParentPool(tokenNameQuote, hasEnoughMarketPool[0], stableTPrice, parentPairParams.precision);
          }
        } else {
          throw new Error('error in quote or base if statement');
        }

        // users to be be informed of $500 barrier to entry/ delta of 100 (500 vs 400) is for wiggle room for ease of use
        if (api.assert(calcResultParentPool && calcResultParentPool.poolValueUSD >= 400, 'token : xxx.d token pool USD value must be at least 500')) {
          // subtract the conversion fee from the amount to be converted
          const feePercentage = api.BigNumber(parentPairParams.feePercentage);
          let fee = '0';
          let finalQty = qtyAsBigNum;
          if (feePercentage.gt(0)) {
            fee = qtyAsBigNum.multipliedBy(feePercentage).toFixed(parentPairParams.precision, api.BigNumber.ROUND_UP);

            if (api.BigNumber(fee).lt('0.00000001')) {
              fee = '0.00000001';
            }

            finalQty = qtyAsBigNum.minus(fee);
          }


          const xxxdToIssue = finalQty.multipliedBy(calcResultParentPool.parentPrice).toFixed(parentPairParams.precision, api.BigNumber.ROUND_DOWN);

          if (!api.assert(api.BigNumber(xxxdToIssue).gt('0001'), `resulting token issuance is too small; token price is ${calcResultParentPool.parentPrice}`)) {
            throw new Error('resulting token issuance is too small');
          }


          const burnResults = burnParentTokens(finalQty, fee, parentPairParams.parentSymbol, parentPairParams.burnRouting, isSignedWithActiveKey);

          api.assert(burnResults, 'error on token burn');

          // finally, issue the new XXX.D
          await api.executeSmartContract('tokens', 'issue', {
            to: api.sender, symbol: parentPairParams.symbol, quantity: xxxdToIssue,
          });

          const keyname = parentPairParams.parentSymbol;
          const childName = parentPairParams.symbol;

          api.emit(`${parentPairParams.symbol} Converted`, {

            to: api.sender, fee, feeRouting: parentPairParams.burnRouting, [keyname]: qtyAsBigNum.toFixed(parentPairParams.precision), [childName]: xxxdToIssue, parentPriceInUSD: calcResultParentPool.parentPrice,
          });

          return true;
        }
      }
    }
  }
  return false;
};
