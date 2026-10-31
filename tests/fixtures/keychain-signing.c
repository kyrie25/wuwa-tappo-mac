#include <Security/Security.h>
#include <stdio.h>
#include <string.h>

int main(int argc, char **argv) {
  if (argc != 3) return 2;
  SecKeychainSetUserInteractionAllowed(false);
  SecKeychainRef keychain = NULL;
  const char password[] = "synthetic-only";
  const char value[] = "synthetic-data";
  CFMutableDictionaryRef query = CFDictionaryCreateMutable(NULL, 0,
    &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  CFDictionarySetValue(query, kSecClass, kSecClassGenericPassword);
  CFDictionarySetValue(query, kSecAttrService, CFSTR("wuwa-signing-test"));
  CFDictionarySetValue(query, kSecAttrAccount, CFSTR("fixture"));
  OSStatus status;
  if (!strcmp(argv[1], "create")) {
    status = SecKeychainCreate(argv[2], sizeof(password) - 1, password, false, NULL, &keychain);
    if (!status) {
      CFDataRef data = CFDataCreate(NULL, (const UInt8 *)value, sizeof(value) - 1);
      CFDictionarySetValue(query, kSecUseKeychain, keychain);
      CFDictionarySetValue(query, kSecValueData, data);
      status = SecItemAdd(query, NULL);
      CFRelease(data);
    }
  } else {
    status = SecKeychainOpen(argv[2], &keychain);
    if (!status) status = SecKeychainUnlock(keychain, sizeof(password) - 1, password, true);
    if (!status) {
      const void *keys[] = { keychain };
      CFArrayRef search = CFArrayCreate(NULL, keys, 1, &kCFTypeArrayCallBacks);
      CFDictionarySetValue(query, kSecMatchSearchList, search);
      CFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);
      CFTypeRef data = NULL;
      status = SecItemCopyMatching(query, &data);
      if (!status && (CFGetTypeID(data) != CFDataGetTypeID()
        || CFDataGetLength(data) != sizeof(value) - 1
        || memcmp(CFDataGetBytePtr(data), value, sizeof(value) - 1))) status = errSecDecode;
      if (data) CFRelease(data);
      CFRelease(search);
    }
  }
  CFRelease(query);
  if (keychain) CFRelease(keychain);
  printf("Signing fixture version %d: OSStatus %d\n", VERSION, (int)status);
  if (status == errSecAuthFailed || status == errSecInteractionNotAllowed) return 3;
  return status ? 1 : 0;
}
