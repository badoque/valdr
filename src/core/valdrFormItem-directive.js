/**
 * This controller is used if no valdrEnabled parent directive is available.
 */
var nullValdrEnabledController = {
  isEnabled: function () {
    return true;
  }
};

/**
 * This controller is used if no valdrFormGroup parent directive is available.
 */
var nullValdrFormGroupController = {
  addFormItem: angular.noop,
  removeFormItem: angular.noop
};

function extractModelValuesFromFormController(FormController){
  console.log('form');
  return function(criteria){
    var otherModelValuesOnForm = {};
    if(FormController !== undefined){
      angular.forEach(FormController, function(value, key){
        if(key[0] !== '$' && criteria(key)){
          otherModelValuesOnForm[key] = value;
        }
      });
    }
    return otherModelValuesOnForm;
  };
}

/**
 * This directive adds validation to all input and select fields as well as to explicitly enabled elements which are
 * bound to an ngModel and are surrounded by a valdrType directive. To prevent adding validation to specific fields,
 * the attribute 'valdr-no-validate' can be added to those fields.
 */
var valdrFormItemDirectiveDefinitionFactory = function (restrict) {
    return ['valdrEvents', 'valdr', 'valdrUtil', '$timeout', '$q', function (valdrEvents, valdr, valdrUtil, $timeout, $q) {
      return {
        restrict: restrict,
        require: ['?^valdrType', '?^ngModel', '?^valdrFormGroup', '?^valdrEnabled', '?^form'],
        link: function (scope, element, attrs, controllers) {

          var valdrTypeController = controllers[0],
            ngModelController = controllers[1],
            valdrFormGroupController = controllers[2] || nullValdrFormGroupController,
            valdrEnabled = controllers[3] || nullValdrEnabledController,
            FormController = controllers[4],
            valdrNoValidate = attrs.valdrNoValidate,
            fieldName = attrs.name;

          /**
           * Don't do anything if
           * - this is an <input> that's not inside of a valdr-type block
           * - there is no ng-model bound to input
           * - there is the 'valdr-no-validate' attribute present
           */
          if (!valdrTypeController || !ngModelController || angular.isDefined(valdrNoValidate)) {
            return;
          }

          valdrFormGroupController.addFormItem(ngModelController);

          if (valdrUtil.isEmpty(fieldName) && valdrEnabled.isEnabled()) {
            console.warn('Form element with ID "' + attrs.id + '" is not bound to a field name.');
          }

          var updateNgModelController = function (validationResult, isAsync) {

            if (valdrEnabled.isEnabled()) {
              var validatorTokens = ['valdr'];

              // set validity state for individual valdr validators
              angular.forEach(validationResult.validationResults, function (result) {
                var validatorToken;
                if(!isAsync && (result.isAsync === false || result.isAsync === undefined) || 
                  isAsync && (result.isAsync !== false || result.isAsync !== undefined)){
                  if(result.isAsync === false || result.isAsync === undefined){
                    validatorToken = valdrUtil.validatorNameToToken(result.validator);
                    ngModelController.$setValidity(validatorToken, result.valid);
                  } else {
                    debugger;
                    validatorToken = valdrUtil.validatorNameToToken(result.validator);
                    result.valid.then(function(){
                      ngModelController.$setValidity(validatorToken, true);
                    }).catch(function(){
                      ngModelController.$setValidity(validatorToken, false);
                    });
                    ngModelController.$setValidity(validatorToken, false);
                    validatorTokens.push(validatorToken);
                  }
                }                
              });

              // set overall validity state of this form item
              if(!isAsync){
                ngModelController.$setValidity('valdr', validationResult.valid);
                ngModelController.valdrViolations = validationResult.violations;
              } else {
                validationResult.valid.then(function(){
                  ngModelController.$setValidity('valdrAsync', true);
                }).catch(function(){
                  ngModelController.$setValidity('valdrAsync', false);
                }).finally(function(){
                  ngModelController.valdrViolations = validationResult.violations;
                })
                
              }
              

              // remove errors for valdr validators which no longer exist
              angular.forEach(ngModelController.$error, function (value, validatorToken) {
                if (validatorTokens.indexOf(validatorToken) === -1 && valdrUtil.startsWith(validatorToken, 'valdr')) {
                  ngModelController.$setValidity(validatorToken, true);
                }
              });
            } else {
              angular.forEach(ngModelController.$error, function (value, validatorToken) {
                if (valdrUtil.startsWith(validatorToken, 'valdr')) {
                  ngModelController.$setValidity(validatorToken, true);
                }
              });
              ngModelController.valdrViolations = undefined;
            }
          };


          var createValidator = function(isAsync){
            return function(modelValue){
              var getOtherModelValuesOnForm = extractModelValuesFromFormController(FormController);
              var validationResult = valdr.validate(valdrTypeController.getType(), fieldName, modelValue, getOtherModelValuesOnForm, isAsync);
              updateNgModelController(validationResult, isAsync);
              if(valdrEnabled.isEnabled()){
                return validationResult.valid;
              } else if(isAsync){
                var deferred = $q.defer();
                deferred.resolve();
                return deferred.promise;
              } else {
                return true;
              }
            };
          };

          var validate = createValidator(false);
          var asyncValidate = createValidator(true);

          ngModelController.$validators.valdr = validate;
          ngModelController.$asyncValidators.valdrAsync = asyncValidate;

          scope.$on(valdrEvents.revalidate, function () {
            validate(ngModelController.$modelValue);
            asyncValidate(ngModelController.$modelValue);
          });

          scope.$on('$destroy', function () {
            valdrFormGroupController.removeFormItem(ngModelController);
          });

        }
      };
    }];
  },
  valdrFormItemElementDirectiveDefinition = valdrFormItemDirectiveDefinitionFactory('E'),
  valdrFormItemAttributeDirectiveDefinition = valdrFormItemDirectiveDefinitionFactory('A');

angular.module('valdr')
  .directive('input', valdrFormItemElementDirectiveDefinition)
  .directive('select', valdrFormItemElementDirectiveDefinition)
  .directive('textarea', valdrFormItemElementDirectiveDefinition)
  .directive('enableValdrValidation', valdrFormItemAttributeDirectiveDefinition);
