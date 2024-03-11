/// remove advertisement of ESM compatibility from non-ESM-native package.jsons,
// as apparently this confuses the living shit out of Jest

module.exports = (path, options) => {
  return options.defaultResolver(path, {
    ...options,
    packageFilter: (pkg) => {
      if (pkg.type === 'module') return pkg;

      const ret = {
        ...pkg,
      };

      for (const exp of Object.values(ret.exports ?? {})) {
        for (const key of ['browser', 'import']) {
          delete exp[key];
        }
      }

      return ret;
    },
  });
};
