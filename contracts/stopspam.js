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
    params.restrictAccounts = {};
    params.authorizedAccounts = {};

    await api.db.insert('params', params);
  }
};


actions.updateParams = async (payload) => {
  if (api.sender !== api.owner) return;

  const {
    numberOfFreeTx,
    timeTillFeeSeconds,
    multiTransactionFee,
    restrictAccounts,
    authorizedAccounts,
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
  if (restrictAccounts && typeof restrictAccounts === 'object') {
    params.multiTransactionFee = multiTransactionFee;
  }

  if (authorizedAccounts && typeof authorizedAccounts === 'object') {
    params.authorizedAccounts = authorizedAccounts;
  }

  await api.db.update('params', params);
};
