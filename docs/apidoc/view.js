/**
 * @class Alloy.View
 * XML reference guide
 */


/**
 * @class Alloy.View.Alloy
 * Parent element for all Alloy XML files.
 */

/**
 * @property autoStyle
 * @type Boolean
 * @since 1.2.0
 * Enables the autostyle feature for dynamic styling when adding or removing classes.
 */

/**
 * @class AlloyViewGlobalAttributes
 * @pseudo
 * Attributes supported by all Titanium view elements.
 */

/**
 * @property id
 * @type String
 * Identifies UI elements in the controller (prefixed with '$.') and style sheet (prefixed with
 * '#'). IDs should be unique per view but are not global, so multiple views can have components
 * with the same ID.
 */

/**
 * @property class
 * @type String
 * Applies additional styles (prefixed with '.' in the TSS file). Overwrites the element style but
 * not the id style.
 */

/**
 * @property autoStyle
 * @type Boolean
 * @since 1.2.0
 * Enables the autostyle feature for dynamic styling when adding or removing classes.
 */

/**
 * @property bindId
 * @type String
 * @since 1.2.0
 * View's ID used for data binding.
 */

/**
 * @property formFactor
 * @type String
 * Acts as a compiler directive for size-specific view components. Value can either be `handheld` or `tablet`.
 */

/** 
 * @property ns
 * @type String
 * Overrides the default namespace of the element.
 */

/**
 * @property platform
 * @type String
 * Switches the namespace based on the platform and acts as a compiler directive for
 * platform-specific view components. Values can be any combination of platforms. 
 */

/** 
 * @class AlloyViewCollectionAttributes
 * @extends AlloyViewGlobalAttributes
 * @pseudo
 * Attributes for Titanium view elements that support collection binding.
 */

/**
 * @property dataCollection
 * @type String
 * Specifies the collection singleton or instance to bind to the table.  This is the name of the
 * model file for singletons or the ID prefixed with the controller symbol ('$') for instances.
 */

/**
 * @property dataTransform
 * @type Function
 * Specifies an optional callback to use to format model attributes.  The passed argument is a model
 * and the return value is a modified model as a JSON object.
 */

/**
 * @property dataFilter
 * @type Function
 * Specifies an optional callback to use to filter data in the collection. The passed argument is a
 * collection and the return value is an array of models.
 */

/**
 * @class Alloy.View.ItemTemplate
 * @pseudo
 * @since 1.2.0
 * 
 */ 
