export const ShortUserDetailsSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  middleName: true,
};

export const UserDetailsSelect = {
  ...ShortUserDetailsSelect,
  password: true,
  isEmailVerified: true,
  isPhoneNumberVerified: true,
  isAccountCreationCompleted: true,
  createdAt: true,
  updatedAt: true,
  role: true,
  gender: true,
  dateOfBirth: true,
  phoneNumber: true,
  bvn: true,
  nin: true,
  category: true,
  address: true,
};
