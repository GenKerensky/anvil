@agent
Feature: Tiling

  Scenario: Tiling mode is enabled by default
    Given the Anvil extension is active
    Then gsetting "tiling-mode-enabled" is "true"

  Scenario: Tree structure exists after opening a window
    Given the Anvil extension is active
    When a window is opened
    Then the tree structure exists
    When the window is closed

  Scenario: Layout settings can be toggled
    Given the Anvil extension is active
    When gsetting "stacked-tiling-mode-enabled" is set to "false"
    Then gsetting "stacked-tiling-mode-enabled" is "false"
    When gsetting "stacked-tiling-mode-enabled" is set to "true"
    Then gsetting "stacked-tiling-mode-enabled" is "true"
    When gsetting "tabbed-tiling-mode-enabled" is set to "false"
    Then gsetting "tabbed-tiling-mode-enabled" is "false"
    When gsetting "tabbed-tiling-mode-enabled" is set to "true"
    Then gsetting "tabbed-tiling-mode-enabled" is "true"
    When gsetting "auto-split-enabled" is set to "false"
    Then gsetting "auto-split-enabled" is "false"
    When gsetting "auto-split-enabled" is set to "true"
    Then gsetting "auto-split-enabled" is "true"
