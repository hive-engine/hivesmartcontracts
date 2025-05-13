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
    await api.db.createTable('accountControls', ['account']);
  }
};

actions.updateParams = async (payload) => {
  if (api.sender !== api.owner) return;

  const {
    numberOfFreeTx,
    multiTransactionFee,
    burnSymbol,
  } = payload;

  const params = await api.db.findOne('params', {});

  if (numberOfFreeTx && Number.isInteger(numberOfFreeTx) && numberOfFreeTx >= 1) {
    params.numberOfFreeTx = numberOfFreeTx;
  }

  const feeBN = api.BigNumber(multiTransactionFee);
  if (multiTransactionFee && typeof multiTransactionFee === 'string' && !feeBN.isNaN() && feeBN.gte(0) && !feeBN.isFinite()) {
    params.multiTransactionFee = multiTransactionFee;
  }

  if (denyMaxTx && Number.isInteger(denyMaxTx) && denyMaxTx >= 0) {
    params.denyMaxTx = denyMaxTx;
  }

  if (burnSymbol && typeof burnSymbol === 'string') {
    // check if the token exists
    const token = await api.db.findOne('tokens', { symbol });
    if (token) {
      params.burnSymbol = burnSymbol;
    }
  }

  await api.db.update('params', params);
};

actions.updateAccount = async (payload) => {
  if (api.sender !== api.owner) return;

  const table = 'accountControls';
  const { account, isDenied, isAllowed } = payload;
  const timestamp = new Date(`${api.hiveBlockTimestamp}.000Z`).getTime();
  const accountControl = await api.db.findOne(table, { account });
  const create = !accountControl;

  const updateAccountControl = setAccountControlProperties(accountControl, account, isDenied, isAllowed, timestamp);

  if (create)
    await api.db.insert(table, updateAccountControl);
  else
    await api.db.update(table, updateAccountControl);

    api.emit('updateAccount', {
      from: api.sender, updatedAccount: account, isDenied, isAllowed
    });
};

actions.removeAccount = async (payload) => {
  if (api.sender !== api.owner) return;

  const { allowList, denyList } = payload;

  const params = await api.db.findOne('params', {});

  let finalAllow = params.allowList ? [...params.allowList] : [];
  let finalDeny = params.denyList ? [...params.denyList] : [];

  if (Array.isArray(allowList) && allowList.length > 0) {
    finalAllow = finalAllow.filter(user => !allowList.includes(user));
  }

  if (Array.isArray(denyList) && denyList.length > 0) {
    finalDeny = finalDeny.filter(user => !denyList.includes(user));
  }
  params.allowList = finalAllow;
  params.denyList = finalDeny;

  await api.db.update('params', params);
};

actions.burnFee = async (payload) => {
  const sender = api.sender;
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

  if (api.userActionCount <= burnParams.numberOfFreeTx) {
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

function setAccountControlProperties(accountControl, account, isDenied, isAllowed, timestamp)
{
  if (!accountControl)
    accountControl = {};

  if (accountControl.account == null || accountControl.account === 'undefined')
    accountControl.account = account;
  if (isDenied != null && isDenied !== 'undefined')
    accountControl.isDenied = isDenied;
  if (isAllowed != null && isAllowed !== 'undefined')
    accountControl.isAllowed = isAllowed;

  accountControl.lastAction = timestamp;

  return accountControl;
}