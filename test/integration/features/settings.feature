@agent
Feature: Settings

  Scenario: Window gap size can be modified
    Given the Anvil extension is active
    When gsetting "window-gap-size" is set to "8"
    Then gsetting "window-gap-size" is "uint32 8"

  Scenario: Tiling mode can be toggled
    Given the Anvil extension is active
    When gsetting "tiling-mode-enabled" is set to "false"
    Then gsetting "tiling-mode-enabled" is "false"
    When gsetting "tiling-mode-enabled" is set to "true"
    Then gsetting "tiling-mode-enabled" is "true"

  Scenario: Float mode settings can be toggled
    Given the Anvil extension is active
    When gsetting "float-always-on-top-enabled" is set to "false"
    Then gsetting "float-always-on-top-enabled" is "false"
    When gsetting "float-always-on-top-enabled" is set to "true"
    Then gsetting "float-always-on-top-enabled" is "true"

  Scenario: Window effect settings can be toggled
    Given the Anvil extension is active
    When gsetting "focus-border-toggle" is set to "false"
    Then gsetting "focus-border-toggle" is "false"
    When gsetting "focus-border-toggle" is set to "true"
    Then gsetting "focus-border-toggle" is "true"
    When gsetting "split-border-toggle" is set to "false"
    Then gsetting "split-border-toggle" is "false"
    When gsetting "split-border-toggle" is set to "true"
    Then gsetting "split-border-toggle" is "true"
    When gsetting "preview-hint-enabled" is set to "false"
    Then gsetting "preview-hint-enabled" is "false"
    When gsetting "preview-hint-enabled" is set to "true"
    Then gsetting "preview-hint-enabled" is "true"
    When gsetting "showtab-decoration-enabled" is set to "false"
    Then gsetting "showtab-decoration-enabled" is "false"
    When gsetting "showtab-decoration-enabled" is set to "true"
    Then gsetting "showtab-decoration-enabled" is "true"
    When gsetting "window-gap-hidden-on-single" is set to "true"
    Then gsetting "window-gap-hidden-on-single" is "true"
    When gsetting "window-gap-hidden-on-single" is set to "false"
    Then gsetting "window-gap-hidden-on-single" is "false"

  Scenario: Focus pointer settings can be toggled
    Given the Anvil extension is active
    When gsetting "move-pointer-focus-enabled" is set to "true"
    Then gsetting "move-pointer-focus-enabled" is "true"
    When gsetting "move-pointer-focus-enabled" is set to "false"
    Then gsetting "move-pointer-focus-enabled" is "false"
    When gsetting "focus-on-hover-enabled" is set to "true"
    Then gsetting "focus-on-hover-enabled" is "true"
    When gsetting "focus-on-hover-enabled" is set to "false"
    Then gsetting "focus-on-hover-enabled" is "false"
    When gsetting "auto-exit-tabbed" is set to "false"
    Then gsetting "auto-exit-tabbed" is "false"
    When gsetting "auto-exit-tabbed" is set to "true"
    Then gsetting "auto-exit-tabbed" is "true"

  Scenario: Effect settings are accessible
    Given the Anvil extension is active
    Then gsetting "focus-border-size" exists
    And gsetting "split-border-color" exists
