/* eslint-disable no-await-in-loop */
/* eslint-disable no-template-curly-in-string */
/* eslint-disable valid-typeof */
/* eslint-disable max-len */
/* eslint-disable no-continue */
/* global actions, api */


actions.createSSC = async () => {
  const tableExists = await api.db.tableExists('params');
  if (tableExists === false) {
    await api.db.createTable('params');

    const params = {};

    params.numberOfFreeTx = '3';
    params.timeTillFeeSeconds = '3';
    params.multiTransactionFee = '.1';
    params.denyList = [];
    params.allowList = [];

    await api.db.insert('params', params);
  }
};

actions.updateParams = async (payload) => {
  if (api.sender !== api.owner) return;

  const {
    numberOfFreeTx,
    timeTillFeeSeconds,
    multiTransactionFee,
  } = payload;

  const params = await api.db.findOne('params', {});

  if (numberOfFreeTx && typeof numberOfFreeTx === 'string' && !api.BigNumber(numberOfFreeTx).isNaN() && api.BigNumber(numberOfFreeTx).gte(0)) {
    params.numberOfFreeTx = numberOfFreeTx;
  }
  if (timeTillFeeSeconds && typeof timeTillFeeSeconds === 'string' && !api.BigNumber(timeTillFeeSeconds).isNaN() && api.BigNumber(timeTillFeeSeconds).gte(0)) {
    params.timeTillFeeSeconds = timeTillFeeSeconds;
  }
  if (multiTransactionFee && typeof multiTransactionFee === 'string' && !api.BigNumber(multiTransactionFee).isNaN() && api.BigNumber(multiTransactionFee).gte(0)) {
    params.multiTransactionFee = multiTransactionFee;
  }

  await api.db.update('params', params);
};


actions.addAccount = async (payload) => {
  if (api.sender !== api.owner) return;

  const { allowList, denyList } = payload;

  const params = await api.db.findOne('params', {});

  let finalAllow = params.allowList ? [...params.allowList] : [];
  let finalDeny = params.denyList ? [...params.denyList] : [];

  // Merge new values if they exist
  if (Array.isArray(allowList) && allowList.length > 0) {
    finalAllow = [...finalAllow, ...allowList];
  }

  if (Array.isArray(denyList) && denyList.length > 0) {
    finalDeny = [...finalDeny, ...denyList];
  }

  params.allowList = finalAllow;
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
