/* eslint-disable no-await-in-loop */
/* eslint-disable no-template-curly-in-string */
/* eslint-disable valid-typeof */
/* eslint-disable max-len */
/* eslint-disable no-continue */
/* global actions, api */

actions.createSSC = async () => {
  const paramsExists = await api.db.tableExists('params');
  if (paramsExists === false) {
    await api.db.createTable('params');
    const params = {};

    params.numberOfFreeTx = 1;
    params.denyMaxTx = 1;
    params.multiTransactionFee = '0.001';
    params.burnSymbol = 'BEED';
  
    await api.db.insert('params', params);
  }

  const accountControlsExists = await api.db.tableExists('accountControls');
  if (accountControlsExists === false) {
    await api.db.createTable('accountControls', [], { primaryKey: ['account'] });
  }
  const moderatorsExists = await api.db.tableExists('moderators');
  if (moderatorsExists === false) {
    await api.db.createTable('moderators', [], { primaryKey: ['account'] });
  }
};

actions.updateParams = async (payload) => {
  if (!api.assert(sender === api.owner, 'not authorized')) 
    return;

  const {
    numberOfFreeTx,
    multiTransactionFee,
    burnSymbol,
    denyMaxTx
  } = payload;

  const params = await api.db.findOne('params', {});

  if (numberOfFreeTx){
    if (!api.assert(Number.isInteger(numberOfFreeTx) && numberOfFreeTx >= 1), 'invalid numberOfFreeTx') 
      return;
    params.numberOfFreeTx = numberOfFreeTx;
  }

  if (multiTransactionFee){
    const feeBN = api.BigNumber(multiTransactionFee);
    if (!api.assert(typeof multiTransactionFee === 'string' && !feeBN.isNaN() && feeBN.gte(0) && feeBN.isFinite()), 'invalid multiTransactionFee') 
      return;
    params.multiTransactionFee = multiTransactionFee;
  }
  
  if (denyMaxTx){
    if (!api.assert(Number.isInteger(denyMaxTx) && denyMaxTx >= 0), 'invalid denyMaxTx') 
      return;
    params.denyMaxTx = denyMaxTx;
  }

  if (burnSymbol) {
    if (!api.assert(typeof burnSymbol === 'string'), 'invalid burnSymbol') 
      return;
    // check if the token exists
    const token = await api.db.findOne('tokens', { symbol: burnSymbol });
    if (!api.assert(token), 'burnSymbol not available') 
      return;
    params.burnSymbol = burnSymbol;
  }

  await api.db.update('params', params);
};

actions.updateAccount = async (payload) => {
  const sender = api.sender;

  const moderator = await api.db.findOne('moderators', {account: sender});
  if (!api.assert(sender === api.owner || moderator, 'not authorized')) 
    return;

  const table = 'accountControls';
  const { account, isDenied, isAllowed } = payload;
  const timestamp = new Date(`${api.hiveBlockTimestamp}.000Z`).getTime();

  let accountControl = await api.db.findOne(table, { account });
  const create = !accountControl;

  if (!accountControl)
    accountControl = { account };

  if (!api.assert(accountControl.account != null && accountControl.account !== 'undefined', 'invalid account')) 
    return;

  if (isDenied != null) {
    if (!api.assert(typeof isDenied === 'boolean', 'invalid isDenied')) 
      return;
    accountControl.isDenied = isDenied;
  }

  if (isAllowed != null) {
    if (!api.assert(typeof isAllowed === 'boolean', 'invalid isAllowed')) 
      return;
    accountControl.isAllowed = isAllowed;
  }

  accountControl.lastAction = timestamp;

  if (create)
    await api.db.insert(table, accountControl);
  else
    await api.db.update(table, accountControl);

  api.emit('updateAccount', {
      from: api.sender, updatedAccount: account, isDenied, isAllowed
    });
};

actions.updateModerator = async (payload) => {
  const sender = api.sender;
  if (!api.assert(sender === api.owner, 'not authorized')) 
    return;

  const table = 'moderators';
  const { account, action } = payload;

  const moderator = await api.db.findOne(table, {account});
  let updated = false;

  if (action === 'add' && !moderator){
    await api.db.insert(table, {account});
    updated = true;
  }
  
  if (action === 'remove' && moderator){
    await api.db.remove(table, moderator);
    updated = true;
  }

  if (updated){
    api.emit('updateModerator', {
        from: api.sender, account, action
    });
  }
};

actions.burnFee = async (payload) => {
  const sender = api.sender;
  if (sender === 'null' || sender == null)
    return;

  const burnParams = await api.db.findOne('params', {});
  const accountControls = await api.db.findOne('accountControls', { account: sender });

  if (accountControls && accountControls.isDenied){
    // check first if account is denied before
    const nowTimestamp = new Date(`${api.hiveBlockTimestamp}.000Z`).getTime();
    const lastActionTimestamp = accountControls.lastAction;
    const diffHours = (nowTimestamp - lastActionTimestamp) / (1000 * 60 * 60);
  
    accountControls.actionCount = (accountControls.actionCount || 0) + 1;
    accountControls.lastAction = nowTimestamp;

    if (diffHours >= 24)
      accountControls.actionCount = 1;

    if (api.assert(diffHours >= 24 || accountControls.actionCount <= burnParams.denyMaxTx, 'max transaction limit per day reached.')) {
      await api.db.update('accountControls', accountControls);
    }
    else {
      return;
    }
  }

  if (payload.userActionCount <= burnParams.numberOfFreeTx) {
    return;
  }

  // no burn needed for any acc on allowList
  if (accountControls && accountControls.isAllowed) {
    return;
  }
  
  // if code is here burn BEED for multi transaction use
  api.emit('burnFee', {
    from: api.sender, to: 'null', symbol: burnParams.burnSymbol, fee: burnParams.multiTransactionFee,
  });

  const feeTransfer = await api.executeSmartContract('tokens', 'transfer', {
    to: 'null', symbol: burnParams.burnSymbol, quantity: burnParams.multiTransactionFee, isSignedWithActiveKey: true,
  });

  api.assert(transferIsSuccessful(feeTransfer, 'transfer', api.sender, 'null', burnParams.burnSymbol, burnParams.multiTransactionFee), 'not enough tokens for multiTransaction fee');
};

// Helper functions
const transferIsSuccessful = (result, action, from, to, symbol, quantity) => result.errors === undefined
    && result.events && result.events.find(el => el.contract === 'tokens'
    && el.event === action
    && el.data.from === from
    && el.data.to === to
    && api.BigNumber(el.data.quantity).eq(quantity)
    && el.data.symbol === symbol) !== undefined;
