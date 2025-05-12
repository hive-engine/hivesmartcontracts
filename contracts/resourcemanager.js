/* eslint-disable no-await-in-loop */
/* eslint-disable no-template-curly-in-string */
/* eslint-disable valid-typeof */
/* eslint-disable max-len */
/* eslint-disable no-continue */
/* global actions, api */


actions.createSSC = async () => {
  const tableExists = await api.db.tableExists('params');
  if (tableExists === false) {
    await api.db.createTable('params', ['numberOfFreeTx', 'denyMaxTx', 'multiTransactionFee', 'burnSymbol', 'denyList', 'allowList']);
    const params = {};

    params.numberOfFreeTx = '1';
    params.denyMaxTx = '1';
    params.multiTransactionFee = '0.001';
    params.burnSymbol = 'BEED';
    params.denyList = [];
    params.allowList = [];
  
    await api.db.insert('params', params);
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

  if (numberOfFreeTx && typeof numberOfFreeTx === 'string' && !api.BigNumber(numberOfFreeTx).isNaN() && api.BigNumber(numberOfFreeTx).gte(1)) {
    params.numberOfFreeTx = numberOfFreeTx;
  }

  if (multiTransactionFee && typeof multiTransactionFee === 'string' && !api.BigNumber(multiTransactionFee).isNaN() && api.BigNumber(multiTransactionFee).gte(0)) {
    params.multiTransactionFee = multiTransactionFee;
  }

  if (denyMaxTx && typeof denyMaxTx === 'string' && !api.BigNumber(denyMaxTx).isNaN() && api.BigNumber(denyMaxTx).gte(0)) {
    params.denyMaxTx = denyMaxTx;
  }

  if (burnSymbol && typeof burnSymbol === 'string') {
    params.burnSymbol = burnSymbol;
  }

  await api.db.update('params', params);
};

const transferIsSuccessful = (result, action, from, to, symbol, quantity) => result.errors === undefined
    && result.events && result.events.find(el => el.contract === 'tokens'
    && el.event === action
    && el.data.from === from
    && el.data.to === to
    && api.BigNumber(el.data.quantity).eq(quantity)
    && el.data.symbol === symbol) !== undefined;


actions.addAccount = async (payload) => {
  if (api.sender !== api.owner) return;

  const { allowList, denyList } = payload;
  const blockDate = new Date(`${api.hiveBlockTimestamp}.000Z`);
  const timestamp = blockDate.getTime();
  const params = await api.db.findOne('params', {});

  let finalDeny = params.denyList ? [...params.denyList] : [];

  if (Array.isArray(denyList) && denyList.length > 0) {
    for (const name of denyList) {
      const alreadyExists = finalDeny.some(entry => entry.name === name);
      if (!alreadyExists) {
        
        finalDeny.push({ name, actionCount: 0, lastAction: timestamp });
      }
    }
  }

  params.denyList = finalDeny;
  await api.db.update('params', params);
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


actions.burnFee = async () => {
  const params = await api.db.findOne('params', {});
  const sender = api.sender;
  let denyEntryIndex = -1;
  let senderOnDenyList = params.denyList.find((entry, index) => {
    if (entry.name === sender) {
      denyEntryIndex = index;
      return true;
    }
    return false;
  });

  // check if user is on deny list
  if (senderOnDenyList) {
    const nowTimestamp = new Date(`${api.hiveBlockTimestamp}.000Z`).getTime();
    const lastActionTimestamp = senderOnDenyList.lastAction;
    const diffHours = (nowTimestamp - lastActionTimestamp) / (1000 * 60 * 60);
  
    senderOnDenyList.actionCount = (senderOnDenyList.actionCount || 0) + 1;
    senderOnDenyList.lastAction = nowTimestamp;

    api.debug(`diffHours: ${diffHours}, actionCount: ${senderOnDenyList.actionCount}, max: ${params.denyMaxTx}`);

    api.assert(!(diffHours < 24 && senderOnDenyList.actionCount > params.denyMaxTx), 'max transaction limit per day reached.');
    
    params.denyList[denyEntryIndex] = senderOnDenyList;
    await api.db.update('params', params);
  }

  api.debug(`Name: ${api.sender} - free: ${params.numberOfFreeTx} - userActionCount: ${api.userActionCount}`);
  if (api.userActionCount <= params.numberOfFreeTx) {
    return;
  }

  // no burn needed for any acc on allowList
  if (params.allowList.includes(api.sender)) {
    return;
  }
  
  // if code is here burn BEED for multi transaction use
  api.emit('burnFee', {
    from: api.sender, to: 'null', symbol: params.burnSymbol, fee: params.multiTransactionFee,
  });

  const feeTransfer = await api.executeSmartContract('tokens', 'transfer', {
    to: 'null', symbol: params.burnSymbol, quantity: params.multiTransactionFee, isSignedWithActiveKey: true,
  });

  api.assert(transferIsSuccessful(feeTransfer, 'transfer', api.sender, 'null', params.burnSymbol, params.multiTransactionFee), 'not enough tokens for multiTransaction fee');
};
