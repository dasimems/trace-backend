export default () => ({
  app: {
    env: process.env.NODE_ENV,
    http: {
      port: parseInt(process?.env?.PORT || '3000', 10) || 3000,
    },
    globalPrefix: '/api',
    versioning: {
      prefix: 'v',
      version: '1',
    },
  },
});
