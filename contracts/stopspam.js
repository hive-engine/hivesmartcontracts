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

    params.numberOfFreeTransActions = '3';
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
    minConvertibleAmount,
    feePercentage,
  } = payload;

  const params = await api.db.findOne('params', {});

  if (minConvertibleAmount && typeof minConvertibleAmount === 'string' && !api.BigNumber(minConvertibleAmount).isNaN() && api.BigNumber(minConvertibleAmount).gte(0)) {
    params.minConvertibleAmount = minConvertibleAmount;
  }
  if (feePercentage && typeof feePercentage === 'string' && !api.BigNumber(feePercentage).isNaN() && api.BigNumber(feePercentage).gte(0)) {
    params.feePercentage = feePercentage;
  }

  await api.db.update('params', params);
};
