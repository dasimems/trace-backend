export const passwordRegexp =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/,
  fullNameRegexp =
    /^[A-Za-z]+(?:[-'][A-Za-z]+)*\s+[A-Za-z]+(?:[-'][A-Za-z]+)*$/,
  redisRegexp = /^rediss?:\/\/(?:[^@]+@)?[^:]+(:\d+)?(\/\d+)?$/,
  postgresRegexp = /^postgres(?:ql)?:\/\/.+:.+@.+\/.+$/,
  phoneNumberRegexp = /^\+\d{10,15}$/,
  emailRegexp = /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  proxyIpRegexp =
    /^(?:\*|true|false|\d+|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})(?:,(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})*)$/i,
  urlTemplateReg = /^https?:\/\/[^\s]+{{[^{}]+}}[^\s]*$/;
