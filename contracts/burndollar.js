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
  const utilityTokenBalance = await api.db.findOneInTable('tokens', 'balances', { account, symbol: symbolFind });
  if (utilityTokenBalance && api.BigNumber(utilityTokenBalance.balance).gte(amount)) {
    return true;
  }
  return false;
};


const verifyMarketPools = async () => {
//   // const childToken = `${parentSymbol}.D`;

  const utilityTokenBalance = await api.db.findOneInTable('marketpools', 'pools', { tokenPair: '' });
  if (utilityTokenBalance) {
    return true;
  }
  return false;
};

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
    await api.db.createTable('burnpair', ['issuer', 'symbol', 'name', 'parentSymbol', 'burnRouting', 'minConvertibleAmount', 'feePercentage', 'callingContractInfo']);

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
  && api.assert((url === undefined || (url && typeof url === 'string')), 'url must be string')
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

          metadata = JSON.stringify(metadata);

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

          await api.db.insert('burnpair', burnPairParams);


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


actions.convert = async (payload) => {
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

      if (!api.assert(hasEnoughBeedBalance, 'not enough BEED balance')) {
        return false;
      }

      const hasEnoughParentBalance = await verifyParentTokenBalance(api.sender, quantity, symbol);
      if (!api.assert(hasEnoughParentBalance, 'not enough parent token balance')) {
        return false;
      }


      const hasEnoughMarketPool = await verifyMarketPools();
      if (!api.assert(hasEnoughMarketPool, 'not enough tokens in market pools')) {
        return false;
      }
    }
  }
  // {
  //   const qtyAsBigNum = api.BigNumber(quantity);
  //   if (api.assert(qtyAsBigNum.gte(params.minConvertibleAmount), `amount to convert must be >= ${params.minConvertibleAmount}`)
  //     && api.assert(countDecimals(quantity) <= UTILITY_TOKEN_PRECISION, 'symbol precision mismatch')) {
  //     const hasEnoughBalance = await verifyUtilityTokenBalance(quantity, api.sender);
  //     if (!api.assert(hasEnoughBalance, 'not enough balance')) {
  //       return false;
  //     }

  //     //     // subtract the conversion fee from the amount to be converted
  //     const feePercentage = api.BigNumber(params.feePercentage);
  //     let fee = '0';
  //     let finalQty = qtyAsBigNum;
  //     if (feePercentage.gt(0)) {
  //       fee = qtyAsBigNum.multipliedBy(feePercentage).toFixed(UTILITY_TOKEN_PRECISION, api.BigNumber.ROUND_UP);

  //       if (api.BigNumber(fee).lt('0.00000001')) {
  //         fee = '0.00000001';
  //       }

  //       finalQty = qtyAsBigNum.minus(fee);
  //     }

  //     // calculate BEE price in dollars based on high liquidity Diesel Pools
  //     // need to do it this way as we can't access external price oracles from the smart contracts system
  //     const beePool = await api.db.findOneInTable('marketpools', 'pools', { tokenPair: 'SWAP.HIVE:BEE' });
  //     const hbdPool = await api.db.findOneInTable('marketpools', 'pools', { tokenPair: 'SWAP.HIVE:SWAP.HBD' });
  //     const beePriceInHive = (beePool && beePool.quotePrice) ? beePool.quotePrice : '0';
  //     const hivePriceInHBD = (hbdPool && hbdPool.basePrice) ? hbdPool.basePrice : '0';
  //     const beePriceInDollars = api.BigNumber(beePriceInHive).multipliedBy(hivePriceInHBD).toFixed(UTILITY_TOKEN_PRECISION, api.BigNumber.ROUND_DOWN);

  //     // calculate how much BEED should be issued
  //     const beedToIssue = finalQty.multipliedBy(beePriceInDollars).toFixed(BEED_PRECISION, api.BigNumber.ROUND_DOWN);
  //     if (!api.assert(api.BigNumber(beedToIssue).gte('0.0001'), `resulting token issuance is too small; BEE price is ${beePriceInDollars}`)) {
  //       return false;
  //     }

  //     // burn the tokens to be converted
  //     if (!(await burnUtilityTokens(quantity, isSignedWithActiveKey))) {
  //       return false;
  //     }

  //     // finally, issue the new BEED
  //     await api.executeSmartContract('tokens', 'issue', {
  //       to: api.sender, symbol: 'BEED', quantity: beedToIssue,
  //     });

  //     api.emit('beeConversion', {
  //       to: api.sender, fee, bee: finalQty.toFixed(UTILITY_TOKEN_PRECISION), beed: beedToIssue, beePriceInUSD: beePriceInDollars,
  //     });

  //     return true;
  //   }
  // }

  // return false;
};
