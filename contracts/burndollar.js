/* eslint-disable no-await-in-loop */
/* eslint-disable no-template-curly-in-string */
/* eslint-disable valid-typeof */
/* eslint-disable max-len */
/* eslint-disable no-continue */
/* global actions, api */


const countDecimals = value => api.BigNumber(value).dp();

const verifyUtilityTokenBalance = async (account) => {
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
  const [firstToken, secondToken] = tokenPair.split(':'); // Split the token pair by ":"

  const stablePairArray = ['SWAP.HBD', 'SWAP.USDT', 'SWAP.DAI', 'SWAP.USDC'];
  // Check if the stable pair is before or after the colon
  if (stablePairArray.includes(firstToken)) {
    return 'quote'; // Stable coin is before the colon in the marketpool and therefore is the quote price
  } if (stablePairArray.includes(secondToken)) {
    return 'base'; // Stable coin is after the colon and in the market pool and therefore the base price
  }
  return stablePairArray; // No stable pair found in the token pair
};

const findStablePools = async (parentSymbol) => {
  // define child symbol
  const childSymbol = `${parentSymbol}.D`;

  const stablePairArray = ['SWAP.HBD', 'SWAP.USDT', 'SWAP.DAI', 'SWAP.USDC'];

  // Define parent-child token pairs
  const parentPairArray = [`${parentSymbol}`, `${childSymbol}`];

  // Define Stable coins


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
    const stableReturn = results.filter(Boolean); // Remove null or undefined values
    return stableReturn;
  } catch (error) {
    console.error(`Error verifying market pools: ${error.message}`);
  }
};

const findMarketPools = async (parentSymbol) => {
  // Validate parentSymbol
  if (!parentSymbol) {
    return false;
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
          : null; // Return null for invalid pools
      }),
    );

    // Filter out null values and return valid objects
    const validPools = results.filter(Boolean);
    return validPools; // Return array of objects with valid pools
  } catch (error) {
    console.error(`Error verifying market pools for ${parentSymbol}: ${error.message}`);
    return []; // Return an empty array in case of error
  }
};


const calcParentPool = async (name) => {
  if (!name) {
    return false;
  }

  return name;
};

// end utility functions
actions.createSSC = async () => {
  const tableExists = await api.db.tableExists('params');
  if (tableExists === false) {
    await api.db.createTable('params');

    /*
    Every token that is created by this smart contract(burndollar) in effect has a parent token
    the intent is that when a user burns a token XXX they would get token XXXD. There shold always be a one to one realtionship
    However the goal is to let the token owner decided how effcient their token conversion is
    A token owner can also decide is they want the ineffiecient portion of their token conversion to be burned or go to a DAO or another account
    This routing is to be controlled by a token issuer using burn routing field om the burndollar_burnpair collection
    */
    await api.db.createTable('burnpair', ['issuer', 'symbol', 'name', 'precision', 'parentSymbol', 'burnRouting', 'minConvertibleAmount', 'feePercentage', 'callingContractInfo']);

    /* For a token_contract owner to issue a new -D token the price is 1000 BEED (burn).
      the smart contrart will bootstrap the -D token into existance
      The underlying token must already exist using seperate established token creation smart contract.
      token_contract owner inherits ownship of the new -D contract
      after the creation of -D token if the token_contract owner wants to edit the paramaters of their -D token they can for 100 BEED (burn).
      if the token and new -D token have sufficient liquidity pools then any user can burn xxx to get xxx-d for 1 BEED(burn).
      The 1 BEED(burn) is seperate from the -D token paramters set by token_contract owner, and is not subject to their edits of a token_contract owner
    */

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
      const dsymbol = `${symbol}.D`;
      const tokenDExists = await api.db.findOneInTable('tokens', 'tokens', { symbol: dsymbol });
      if (api.assert(burnAccount !== null, 'account for burn routing must exist')
        && api.assert(tokenDExists === null, 'D token must not already exist')
      ) {
        try {
          const finalname = name === undefined ? '' : name;

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
          console.error(error);
        }
      }
    }
  }
};


actions.updateBurnPair = async (payload) => { //    this function will update the parameters of the D token in the burnpair table
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
      const hasEnoughParentBalance = await verifyParentTokenBalance(api.sender, quantity, symbol);
      const hasEnoughMarketPool = await findMarketPools(symbol);
      const hasEnoughStablePool = await findStablePools(symbol);

      if (api.assert(hasEnoughBeedBalance, 'not enough BEED balance')
          && api.assert(hasEnoughParentBalance, 'not enough parent token to convert')
          && api.assert(hasEnoughMarketPool, 'parent token and xxx.D token must have market pool')
          && api.assert(hasEnoughStablePool, 'pool with stable coin must exist')) {
        const quoteOrBase = checkStablePosition(hasEnoughStablePool[0].tokenPair);
        let calcResultParentPool;

        if (quoteOrBase && quoteOrBase === 'base') {
          const stablePrice = hasEnoughStablePool[0].basePrice;
          const stableQuant = hasEnoughStablePool[0].baseQuantity;
          const tokenNameBase = hasEnoughStablePool[0].tokenPair.split(':')[0];

          const stableUSDValue = api.BigNumber(stablePrice).multipliedBy(stableQuant).toFixed(parentPairParams.precision, api.BigNumber.ROUND_DOWN);

          // marketpool balance the value of 1 token versus the other to get a conservative value of the pool multiple the value of one side by 1.95
          const finalValueQuote = api.BigNumber(stableUSDValue).multipliedBy(1.95).toFixed(parentPairParams.precision, api.BigNumber.ROUND_DOWN);

          // users to be be informed of $500 barrier to entry/ delta pf 100 (500 vs 400) is for wiggle room for ease of use
          if (api.assert(finalValueQuote && finalValueQuote >= 400, 'stable token pool USD value must be at least 500')) {
            calcResultParentPool = await calcParentPool(tokenNameBase);
          }
        } else if (quoteOrBase && quoteOrBase === 'quote') {
          const { quotePrice } = hasEnoughStablePool[0];
          const quoteQuant = hasEnoughStablePool[0].quoteQuantity;
          const tokenNameQuote = hasEnoughStablePool[0].tokenPair.split(':')[1];

          const stableUSDValue = api.BigNumber(quotePrice).multipliedBy(quoteQuant).toFixed(parentPairParams.precision, api.BigNumber.ROUND_DOWN);

          // marketpool balance the value of 1 token versus the other to get a conservative value of the pool multiple the value of one side by 1.95
          const finalValueQuote = api.BigNumber(stableUSDValue).multipliedBy(1.95).toFixed(parentPairParams.precision, api.BigNumber.ROUND_DOWN);

          // users to be be informed of $500 barrier to entry/ delta pf 100 (500 vs 400) is for wiggle room for ease of use
          if (api.assert(finalValueQuote && finalValueQuote >= 400, 'stable token pool USD value must be at least 500')) {
            calcResultParentPool = await calcParentPool(tokenNameQuote);
          }
        } else {
          return false;
        }

        api.assert(!calcResultParentPool, calcResultParentPool);
      }
    }
  }
};
