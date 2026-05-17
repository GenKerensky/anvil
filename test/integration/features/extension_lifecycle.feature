@agent
Feature: Extension Lifecycle

  Scenario: Extension is active and error-free
    Given the Anvil extension is active
    Then the extension has no errors
    And test-mode is enabled

  Scenario: Extension can be disabled and re-enabled without errors
    Given the Anvil extension is active
    When the extension is disabled
    Then the extension is inactive
    When the extension is enabled
    Then the extension is active state
    And the extension has no errors
