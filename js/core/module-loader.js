// 景叙模块化加载基础
// 第一阶段：为后续拆分 App 逻辑提供统一入口

window.JXModules = window.JXModules || {};

window.JXModules.register = function(name, module) {
  window.JXModules[name] = module;
};

window.JXModules.get = function(name) {
  return window.JXModules[name];
};
