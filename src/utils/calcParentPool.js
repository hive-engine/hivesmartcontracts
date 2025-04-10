const calcParentPool = async (name, pool, tokenPriceUSD, precision) => {
  if (!name || !pool || !tokenPriceUSD || !precision) {
    throw new Error('Missing required parameters: name, pool, tokenPriceUSD, or precision');
  }

  const [firstToken, secondToken] = pool.tokenPair.split(':'); // Split the token pair by ":"

  let quoteOrBasePosition;
  let otherTokenPriceUSD;
  let halfPoolinUSD;
  let fullPoolinUSD;

  // Check if the match is before or after the colon
  if (name.includes(firstToken)) {
    // Match is before the colon in the marketpool and therefore is the quote price
    quoteOrBasePosition = 'base';
  } else if (name.includes(secondToken)) {
    // Match is after the colon and in the market pool and therefore the base price
    quoteOrBasePosition = 'quote';
  } else {
    throw new Error(`Token name ${name} not found in token pair ${pool.tokenPair}`);
  }

  // perform calc based on first position === base
  if (quoteOrBasePosition === 'base') {
    // we have the price of one token from the stable pool calc, we need to calc the price of the token's pair
    otherTokenPriceUSD = api.BigNumber(pool.quotePrice).multipliedBy(tokenPriceUSD).toFixed(precision, api.BigNumber.ROUND_DOWN);
    halfPoolinUSD = api.BigNumber(otherTokenPriceUSD).multipliedBy(pool.baseQuantity).toFixed(precision, api.BigNumber.ROUND_DOWN);
    // conservative value of the pool multiple the value the halfpool by 1.95
    fullPoolinUSD = api.BigNumber(halfPoolinUSD).multipliedBy(1.95).toFixed(precision, api.BigNumber.ROUND_DOWN);
  } else {
    // perform calc based on second postion === quote
    // we have the price of one token from the stable pool calc, we need to calc the price of the token's pair
    otherTokenPriceUSD = api.BigNumber(pool.basePrice).multipliedBy(tokenPriceUSD).toFixed(precision, api.BigNumber.ROUND_DOWN);
    halfPoolinUSD = api.BigNumber(otherTokenPriceUSD).multipliedBy(pool.quoteQuantity).toFixed(precision, api.BigNumber.ROUND_DOWN);
    // conservative value of the pool multiple the value the halfpool by 1.95
    fullPoolinUSD = api.BigNumber(halfPoolinUSD).multipliedBy(1.95).toFixed(precision, api.BigNumber.ROUND_DOWN);
  }

  return {
    quoteOrBasePosition,
    otherTokenPriceUSD,
    halfPoolinUSD,
    fullPoolinUSD,
  };
};
